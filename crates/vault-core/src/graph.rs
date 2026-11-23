use crate::db::Database;
use crate::model::{GraphEdge, GraphNode, GraphPathResult, GraphSnapshot, LinkType};
use anyhow::Result;
use petgraph::graph::{NodeIndex, UnGraph};
use rayon::prelude::*;
use std::collections::{HashMap, HashSet, VecDeque};
use std::f64::consts::PI;
use std::time::Instant;

/// Computes a force-directed graph layout, centrality metrics, and community clusters
/// in native multi-threaded Rust using `petgraph` and `rayon`.
pub fn build_graph_snapshot(db: &Database, include_tags: bool) -> Result<GraphSnapshot> {
    let start = Instant::now();
    let (docs, links) = db.get_graph_raw_data()?;

    let mut graph = UnGraph::<String, ()>::new_undirected();
    let mut id_to_idx: HashMap<String, NodeIndex> = HashMap::new();
    let mut nodes_meta: Vec<(String, String, Option<String>, String)> = Vec::new();

    for (doc_id, title, path, _tags) in &docs {
        let idx = graph.add_node(doc_id.clone());
        id_to_idx.insert(doc_id.clone(), idx);
        nodes_meta.push((
            doc_id.clone(),
            title.clone(),
            Some(path.clone()),
            "document".to_string(),
        ));
    }

    let mut edge_weights: HashMap<(String, String, &'static str), (LinkType, usize)> =
        HashMap::new();

    for (src_doc_id, target_doc_id, target_raw, link_type) in &links {
        if !id_to_idx.contains_key(src_doc_id) {
            continue;
        }
        match link_type {
            LinkType::Tag => {
                if !include_tags {
                    continue;
                }
                let tag_id = format!("tag:{}", target_raw);
                if !id_to_idx.contains_key(&tag_id) {
                    let idx = graph.add_node(tag_id.clone());
                    id_to_idx.insert(tag_id.clone(), idx);
                    nodes_meta.push((
                        tag_id.clone(),
                        format!("#{}", target_raw),
                        None,
                        "tag".to_string(),
                    ));
                }
                let key = canonical_edge_key(src_doc_id, &tag_id, link_type.as_str());
                edge_weights
                    .entry(key)
                    .and_modify(|e| e.1 += 1)
                    .or_insert((*link_type, 1));
            }
            _ => {
                if let Some(ref tgt_id) = target_doc_id {
                    if tgt_id != src_doc_id && id_to_idx.contains_key(tgt_id) {
                        let key = canonical_edge_key(src_doc_id, tgt_id, link_type.as_str());
                        edge_weights
                            .entry(key)
                            .and_modify(|e| e.1 += 1)
                            .or_insert((*link_type, 1));
                    }
                } else if !target_raw.is_empty() && nodes_meta.len() < 800 {
                    // Show unresolved "ghost" link targets in small/medium vaults
                    let ghost_id = format!("unresolved:{}", target_raw.to_lowercase());
                    if !id_to_idx.contains_key(&ghost_id) {
                        let idx = graph.add_node(ghost_id.clone());
                        id_to_idx.insert(ghost_id.clone(), idx);
                        nodes_meta.push((
                            ghost_id.clone(),
                            target_raw.clone(),
                            None,
                            "unresolved".to_string(),
                        ));
                    }
                    let key = canonical_edge_key(src_doc_id, &ghost_id, link_type.as_str());
                    edge_weights
                        .entry(key)
                        .and_modify(|e| e.1 += 1)
                        .or_insert((*link_type, 1));
                }
            }
        }
    }

    let mut edges: Vec<GraphEdge> = Vec::with_capacity(edge_weights.len());
    let mut adj: Vec<Vec<usize>> = vec![Vec::new(); nodes_meta.len()];

    for ((src, tgt, _kind), (link_type, weight)) in edge_weights {
        if let (Some(&s_idx), Some(&t_idx)) = (id_to_idx.get(&src), id_to_idx.get(&tgt)) {
            graph.add_edge(s_idx, t_idx, ());
            let si = s_idx.index();
            let ti = t_idx.index();
            adj[si].push(ti);
            adj[ti].push(si);
            edges.push(GraphEdge {
                source: src,
                target: tgt,
                link_type,
                weight,
            });
        }
    }

    let n = nodes_meta.len();
    let (cluster_ids, cluster_count) = compute_clusters(&adj, n);
    let centrality = compute_pagerank(&adj, n, 16);
    let positions = compute_force_directed_layout(&adj, n);

    let nodes = nodes_meta
        .into_iter()
        .enumerate()
        .map(|(i, (id, label, path, node_kind))| GraphNode {
            id,
            label,
            path,
            node_kind,
            x: positions[i].0,
            y: positions[i].1,
            degree: adj[i].len(),
            centrality: centrality[i],
            cluster_id: cluster_ids[i],
        })
        .collect();

    Ok(GraphSnapshot {
        nodes,
        edges,
        computed_in_us: start.elapsed().as_micros() as u64,
        cluster_count,
    })
}

/// Finds the shortest path between two documents in the knowledge graph using BFS.
pub fn find_shortest_path(db: &Database, from_doc_id: &str, to_doc_id: &str) -> Result<GraphPathResult> {
    let (docs, links) = db.get_graph_raw_data()?;
    let mut title_map: HashMap<String, String> = HashMap::new();
    let mut adj: HashMap<String, Vec<String>> = HashMap::new();

    for (id, title, _, _) in &docs {
        title_map.insert(id.clone(), title.clone());
        adj.entry(id.clone()).or_default();
    }

    for (src, tgt_opt, _, link_type) in &links {
        if matches!(link_type, LinkType::Tag) {
            continue;
        }
        if let Some(ref tgt) = tgt_opt {
            if src != tgt && title_map.contains_key(src) && title_map.contains_key(tgt) {
                adj.entry(src.clone()).or_default().push(tgt.clone());
                adj.entry(tgt.clone()).or_default().push(src.clone());
            }
        }
    }

    if from_doc_id == to_doc_id {
        let label = title_map
            .get(from_doc_id)
            .cloned()
            .unwrap_or_else(|| from_doc_id.to_string());
        return Ok(GraphPathResult {
            found: true,
            path_node_ids: vec![from_doc_id.to_string()],
            path_labels: vec![label],
            hops: 0,
        });
    }

    let mut queue = VecDeque::new();
    let mut visited = HashSet::new();
    let mut prev: HashMap<String, String> = HashMap::new();

    queue.push_back(from_doc_id.to_string());
    visited.insert(from_doc_id.to_string());

    let mut found = false;
    while let Some(curr) = queue.pop_front() {
        if curr == to_doc_id {
            found = true;
            break;
        }
        if let Some(neighbors) = adj.get(&curr) {
            for nb in neighbors {
                if visited.insert(nb.clone()) {
                    prev.insert(nb.clone(), curr.clone());
                    queue.push_back(nb.clone());
                }
            }
        }
    }

    if !found {
        return Ok(GraphPathResult {
            found: false,
            path_node_ids: Vec::new(),
            path_labels: Vec::new(),
            hops: 0,
        });
    }

    let mut path = Vec::new();
    let mut curr = to_doc_id.to_string();
    path.push(curr.clone());
    while let Some(p) = prev.get(&curr) {
        curr = p.clone();
        path.push(curr.clone());
        if curr == from_doc_id {
            break;
        }
    }
    path.reverse();

    let path_labels = path
        .iter()
        .map(|id| title_map.get(id).cloned().unwrap_or_else(|| id.clone()))
        .collect();
    let hops = path.len().saturating_sub(1);

    Ok(GraphPathResult {
        found: true,
        path_node_ids: path,
        path_labels,
        hops,
    })
}

fn canonical_edge_key(a: &str, b: &str, kind: &'static str) -> (String, String, &'static str) {
    if a <= b {
        (a.to_string(), b.to_string(), kind)
    } else {
        (b.to_string(), a.to_string(), kind)
    }
}

fn compute_clusters(adj: &[Vec<usize>], n: usize) -> (Vec<usize>, usize) {
    let mut cluster_ids = vec![0usize; n];
    let mut visited = vec![false; n];
    let mut cluster_idx = 0usize;

    for i in 0..n {
        if visited[i] {
            continue;
        }
        let mut queue = VecDeque::new();
        queue.push_back(i);
        visited[i] = true;
        while let Some(u) = queue.pop_front() {
            cluster_ids[u] = cluster_idx;
            for &v in &adj[u] {
                if !visited[v] {
                    visited[v] = true;
                    queue.push_back(v);
                }
            }
        }
        cluster_idx += 1;
    }

    (cluster_ids, cluster_idx)
}

fn compute_pagerank(adj: &[Vec<usize>], n: usize, iterations: usize) -> Vec<f64> {
    if n == 0 {
        return Vec::new();
    }
    let damping = 0.85;
    let base = (1.0 - damping) / (n as f64);
    let mut rank = vec![1.0 / (n as f64); n];
    let mut next_rank = vec![base; n];

    for _ in 0..iterations {
        next_rank.fill(base);
        for u in 0..n {
            let deg = adj[u].len();
            if deg == 0 {
                continue;
            }
            let contrib = damping * rank[u] / (deg as f64);
            for &v in &adj[u] {
                next_rank[v] += contrib;
            }
        }
        std::mem::swap(&mut rank, &mut next_rank);
    }
    rank
}

fn compute_force_directed_layout(adj: &[Vec<usize>], n: usize) -> Vec<(f64, f64)> {
    if n == 0 {
        return Vec::new();
    }
    if n == 1 {
        return vec![(0.0, 0.0)];
    }

    // Golden-angle spiral initialization prevents initial overlaps and speeds up convergence.
    let mut pos: Vec<(f64, f64)> = (0..n)
        .map(|i| {
            let angle = (i as f64) * 2.399963229728653;
            let radius = 38.0 * ((i + 1) as f64).sqrt();
            (radius * angle.cos(), radius * angle.sin())
        })
        .collect();

    if n > 2500 {
        // Fast radial/degree layout for huge multi-thousand node graphs to stay sub-50ms.
        let mut sorted: Vec<usize> = (0..n).collect();
        sorted.sort_by_key(|&i| std::cmp::Reverse(adj[i].len()));
        for (rank_i, node_idx) in sorted.into_iter().enumerate() {
            let angle = (rank_i as f64) * 2.0 * PI / ((n as f64).sqrt().max(8.0));
            let r = 20.0 * ((rank_i + 1) as f64).sqrt();
            pos[node_idx] = (r * angle.cos(), r * angle.sin());
        }
        return pos;
    }

    let area_k = 140.0;
    let iterations = if n > 500 { 35 } else { 75 };
    let mut temp = 90.0;
    let cooling = temp / (iterations as f64);

    for _ in 0..iterations {
        let forces: Vec<(f64, f64)> = (0..n)
            .into_par_iter()
            .map(|i| {
                let (xi, yi) = pos[i];
                let mut fx = 0.0;
                let mut fy = 0.0;

                // Repulsive forces between nodes
                for (j, &(xj, yj)) in pos.iter().enumerate() {
                    if i == j {
                        continue;
                    }
                    let dx = xi - xj;
                    let dy = yi - yj;
                    let dist_sq = (dx * dx + dy * dy).max(1.0);
                    let dist = dist_sq.sqrt();
                    let rep = (area_k * area_k) / dist;
                    fx += (dx / dist) * rep;
                    fy += (dy / dist) * rep;
                }

                // Attractive spring forces along edges
                for &nb in &adj[i] {
                    let (xj, yj) = pos[nb];
                    let dx = xj - xi;
                    let dy = yj - yi;
                    let dist = (dx * dx + dy * dy).sqrt().max(0.01);
                    let att = (dist * dist) / area_k;
                    fx += (dx / dist) * att * 0.65;
                    fy += (dy / dist) * att * 0.65;
                }

                // Gentle center gravity so disconnected islands don't drift to infinity
                fx -= xi * 0.08;
                fy -= yi * 0.08;

                (fx, fy)
            })
            .collect();

        for i in 0..n {
            let (fx, fy) = forces[i];
            let mag = (fx * fx + fy * fy).sqrt().max(0.001);
            let step = mag.min(temp);
            pos[i].0 += (fx / mag) * step;
            pos[i].1 += (fy / mag) * step;
        }

        temp = (temp - cooling).max(1.0);
    }

    pos
}

#[cfg(test)]
mod tests {
    use crate::VaultEngine;
    use tempfile::tempdir;

    #[test]
    fn graph_snapshot_and_shortest_path_handle_connected_and_disconnected_nodes() {
        let dir = tempdir().unwrap();
        let vault = dir.path().join("vault");
        let db_path = dir.path().join("index.sqlite");
        let mut engine = VaultEngine::open(&vault, Some(db_path)).unwrap();

        engine
            .save_markdown_document("A.md", "# A\n\nLink zu [[B]] #rust\n")
            .unwrap();
        engine
            .save_markdown_document("B.md", "# B\n\nLink zu [[C]]\n")
            .unwrap();
        engine
            .save_markdown_document("C.md", "# C\n\nEnde.\n")
            .unwrap();
        engine
            .save_markdown_document("Insel.md", "# Insel\n\nKeine Links.\n")
            .unwrap();

        let snap_with_tags = engine.get_graph_snapshot(true).unwrap();
        let snap_no_tags = engine.get_graph_snapshot(false).unwrap();
        assert!(snap_with_tags.nodes.len() > snap_no_tags.nodes.len());
        assert_eq!(snap_no_tags.nodes.len(), 4);

        let docs = engine.list_documents().unwrap();
        let id_of = |name: &str| docs.iter().find(|d| d.path == name).unwrap().id.clone();

        let path_ac = engine.find_graph_path(&id_of("A.md"), &id_of("C.md")).unwrap();
        assert!(path_ac.found);
        assert_eq!(path_ac.hops, 2);

        let path_isolated = engine
            .find_graph_path(&id_of("A.md"), &id_of("Insel.md"))
            .unwrap();
        assert!(!path_isolated.found);
        assert_eq!(path_isolated.hops, 0);
    }
}
