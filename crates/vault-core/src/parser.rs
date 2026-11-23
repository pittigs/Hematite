use crate::model::{
    Block, BlockType, Document, ExtractedLink, LinkType, TaskMetadata, TaskStatus,
};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone)]
pub struct ParsedBlock {
    pub block: Block,
    pub links: Vec<ExtractedLink>,
}

#[derive(Debug, Clone)]
pub struct ParsedDocument {
    pub document: Document,
    pub blocks: Vec<ParsedBlock>,
}

/// Generates a deterministic document ID from its relative path (unless overridden by frontmatter).
pub fn deterministic_doc_id(rel_path: &str) -> String {
    let hash = blake3::hash(format!("doc:{}", rel_path).as_bytes());
    let hex = hash.to_hex();
    format!("doc-{}", &hex[..16])
}

/// Generates a deterministic implicit block ID when no explicit `^id` marker exists in Markdown.
pub fn deterministic_block_id(doc_id: &str, block_index: usize) -> String {
    let hash = blake3::hash(format!("blk:{}:{}", doc_id, block_index).as_bytes());
    let hex = hash.to_hex();
    format!("b-{}", &hex[..10])
}

/// Parses a Markdown document into a structured `ParsedDocument` containing document metadata,
/// hierarchical blocks, extracted links, tags, inline properties, and task metadata.
pub fn parse_markdown_document(
    rel_path: &str,
    markdown: &str,
    created_at: i64,
    updated_at: i64,
) -> ParsedDocument {
    let blake3_hash = blake3::hash(markdown.as_bytes()).to_hex().to_string();
    let (frontmatter, body_start_offset) = parse_frontmatter(markdown);
    let body = &markdown[body_start_offset..];

    let doc_id = frontmatter
        .get("id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| deterministic_doc_id(rel_path));

    let mut doc_tags: BTreeSet<String> = BTreeSet::new();
    if let Some(tags_val) = frontmatter.get("tags") {
        collect_frontmatter_tags(tags_val, &mut doc_tags);
    }

    let mut parsed_blocks: Vec<ParsedBlock> = Vec::new();
    // Stack of (depth, block_id) to compute parent_block_id cleanly.
    let mut parent_stack: Vec<(u32, String)> = Vec::new();

    let lines: Vec<&str> = body.lines().collect();
    let mut i = 0usize;
    let mut block_idx = 0usize;

    while i < lines.len() {
        let line = lines[i];
        let trimmed = line.trim();

        if trimmed.is_empty() {
            i += 1;
            continue;
        }

        // 1. Fenced code block
        let leading_spaces = count_leading_spaces(line);
        let depth = (leading_spaces / 2) as u32;
        if trimmed.starts_with("```") {
            let lang = trimmed.trim_start_matches('`').trim();
            let code_lang = if lang.is_empty() {
                None
            } else {
                Some(lang.to_string())
            };
            i += 1;
            let mut code_lines = Vec::new();
            while i < lines.len() {
                if lines[i].trim().starts_with("```") {
                    i += 1;
                    break;
                }
                code_lines.push(lines[i]);
                i += 1;
            }
            let mut raw = code_lines.join("\n");
            let explicit_id = extract_trailing_block_id(&mut raw);
            let block_id = explicit_id
                .clone()
                .unwrap_or_else(|| deterministic_block_id(&doc_id, block_idx));
            let parent_block_id = resolve_parent(&mut parent_stack, depth, &block_id);
            let block = Block {
                id: block_id,
                doc_id: doc_id.clone(),
                parent_block_id,
                depth,
                sort_order: ((block_idx + 1) as f64) * 1000.0,
                block_type: BlockType::CodeBlock,
                heading_level: None,
                code_lang,
                has_explicit_id: explicit_id.is_some(),
                plain_text: raw.clone(),
                raw_content: raw,
                properties: BTreeMap::new(),
                tags: Vec::new(),
                collapsed: false,
                task: None,
                updated_at,
            };
            parsed_blocks.push(ParsedBlock {
                block,
                links: Vec::new(),
            });
            block_idx += 1;
            continue;
        }

        // 2. Divider (`---`, `***`, `___`)
        if is_divider(trimmed) {
            let block_id = deterministic_block_id(&doc_id, block_idx);
            let parent_block_id = resolve_parent(&mut parent_stack, 0, &block_id);
            let block = Block {
                id: block_id,
                doc_id: doc_id.clone(),
                parent_block_id,
                depth: 0,
                sort_order: ((block_idx + 1) as f64) * 1000.0,
                block_type: BlockType::Divider,
                heading_level: None,
                code_lang: None,
                has_explicit_id: false,
                raw_content: trimmed.to_string(),
                plain_text: String::new(),
                properties: BTreeMap::new(),
                tags: Vec::new(),
                collapsed: false,
                task: None,
                updated_at,
            };
            parsed_blocks.push(ParsedBlock {
                block,
                links: Vec::new(),
            });
            block_idx += 1;
            i += 1;
            continue;
        }

        // 3. Heading (`# ...`)
        if let Some((level, heading_text)) = parse_heading(trimmed) {
            let mut raw = heading_text.to_string();
            let explicit_id = extract_trailing_block_id(&mut raw);
            let block_id = explicit_id
                .clone()
                .unwrap_or_else(|| deterministic_block_id(&doc_id, block_idx));
            let parent_block_id = resolve_parent(&mut parent_stack, 0, &block_id);
            let (properties, tags, links) = extract_inline_semantics(&raw);
            for t in &tags {
                doc_tags.insert(t.clone());
            }
            let plain_text = strip_markdown_syntax(&raw);
            let block = Block {
                id: block_id,
                doc_id: doc_id.clone(),
                parent_block_id,
                depth: 0,
                sort_order: ((block_idx + 1) as f64) * 1000.0,
                block_type: BlockType::Heading,
                heading_level: Some(level),
                code_lang: None,
                has_explicit_id: explicit_id.is_some(),
                raw_content: raw,
                plain_text,
                properties,
                tags,
                collapsed: false,
                task: None,
                updated_at,
            };
            parsed_blocks.push(ParsedBlock { block, links });
            block_idx += 1;
            i += 1;
            continue;
        }

        // 4. Callout or Blockquote (`> ...`)
        if trimmed.starts_with('>') {
            let mut quote_lines = Vec::new();
            while i < lines.len() && lines[i].trim().starts_with('>') {
                let inner = lines[i].trim().trim_start_matches('>').trim_start();
                quote_lines.push(inner);
                i += 1;
            }
            let mut raw = quote_lines.join("\n");
            let is_callout = raw.starts_with("[!");
            let explicit_id = extract_trailing_block_id(&mut raw);
            let block_id = explicit_id
                .clone()
                .unwrap_or_else(|| deterministic_block_id(&doc_id, block_idx));
            let parent_block_id = resolve_parent(&mut parent_stack, depth, &block_id);
            let (properties, tags, links) = extract_inline_semantics(&raw);
            for t in &tags {
                doc_tags.insert(t.clone());
            }
            let plain_text = strip_markdown_syntax(&raw);
            let block = Block {
                id: block_id,
                doc_id: doc_id.clone(),
                parent_block_id,
                depth,
                sort_order: ((block_idx + 1) as f64) * 1000.0,
                block_type: if is_callout {
                    BlockType::Callout
                } else {
                    BlockType::Quote
                },
                heading_level: None,
                code_lang: None,
                has_explicit_id: explicit_id.is_some(),
                raw_content: raw,
                plain_text,
                properties,
                tags,
                collapsed: false,
                task: None,
                updated_at,
            };
            parsed_blocks.push(ParsedBlock { block, links });
            block_idx += 1;
            continue;
        }

        // 5. Task or List item (`- `, `* `, `+ `, `1. `)
        if let Some((is_task, task_status, item_body)) = parse_list_or_task_prefix(trimmed) {
            let mut item_lines = vec![item_body.to_string()];
            i += 1;
            // Attach indented continuation lines (e.g., indented properties like `  deadline:: 2026-11-20`)
            while i < lines.len() {
                let next = lines[i];
                let next_trim = next.trim();
                if next_trim.is_empty() {
                    break;
                }
                let next_indent = count_leading_spaces(next);
                if next_indent > leading_spaces && parse_list_or_task_prefix(next_trim).is_none() && !next_trim.starts_with('#') && !next_trim.starts_with("```") && !next_trim.starts_with('>') {
                    item_lines.push(next_trim.to_string());
                    i += 1;
                } else {
                    break;
                }
            }
            let mut raw = item_lines.join("\n");
            let explicit_id = extract_trailing_block_id(&mut raw);
            let block_id = explicit_id
                .clone()
                .unwrap_or_else(|| deterministic_block_id(&doc_id, block_idx));
            let parent_block_id = resolve_parent(&mut parent_stack, depth, &block_id);
            let (properties, tags, links) = extract_inline_semantics(&raw);
            for t in &tags {
                doc_tags.insert(t.clone());
            }
            let task = if is_task {
                Some(build_task_metadata(task_status.unwrap_or(TaskStatus::Todo), &raw, &properties))
            } else {
                None
            };
            let plain_text = strip_markdown_syntax(&raw);
            let block = Block {
                id: block_id,
                doc_id: doc_id.clone(),
                parent_block_id,
                depth,
                sort_order: ((block_idx + 1) as f64) * 1000.0,
                block_type: if is_task {
                    BlockType::TaskItem
                } else {
                    BlockType::ListItem
                },
                heading_level: None,
                code_lang: None,
                has_explicit_id: explicit_id.is_some(),
                raw_content: raw,
                plain_text,
                properties,
                tags,
                collapsed: false,
                task,
                updated_at,
            };
            parsed_blocks.push(ParsedBlock { block, links });
            block_idx += 1;
            continue;
        }

        // 6. Regular Paragraph (consecutive plain lines until blank line or structural marker)
        let mut para_lines = Vec::new();
        while i < lines.len() {
            let cur = lines[i];
            let cur_trim = cur.trim();
            if cur_trim.is_empty()
                || cur_trim.starts_with("```")
                || is_divider(cur_trim)
                || parse_heading(cur_trim).is_some()
                || cur_trim.starts_with('>')
                || parse_list_or_task_prefix(cur_trim).is_some()
            {
                break;
            }
            para_lines.push(cur_trim);
            i += 1;
        }
        let mut raw = para_lines.join("\n");
        let explicit_id = extract_trailing_block_id(&mut raw);
        let block_id = explicit_id
            .clone()
            .unwrap_or_else(|| deterministic_block_id(&doc_id, block_idx));
        let parent_block_id = resolve_parent(&mut parent_stack, depth, &block_id);
        let (properties, tags, links) = extract_inline_semantics(&raw);
        for t in &tags {
            doc_tags.insert(t.clone());
        }
        let plain_text = strip_markdown_syntax(&raw);
        let block = Block {
            id: block_id,
            doc_id: doc_id.clone(),
            parent_block_id,
            depth,
            sort_order: ((block_idx + 1) as f64) * 1000.0,
            block_type: BlockType::Paragraph,
            heading_level: None,
            code_lang: None,
            has_explicit_id: explicit_id.is_some(),
            raw_content: raw,
            plain_text,
            properties,
            tags,
            collapsed: false,
            task: None,
            updated_at,
        };
        parsed_blocks.push(ParsedBlock { block, links });
        block_idx += 1;
    }

    let title = derive_title(rel_path, &frontmatter, &parsed_blocks);

    ParsedDocument {
        document: Document {
            id: doc_id,
            path: rel_path.to_string(),
            title,
            blake3_hash,
            frontmatter,
            tags: doc_tags.into_iter().collect(),
            created_at,
            updated_at,
        },
        blocks: parsed_blocks,
    }
}

/// Serializes a `Document` and its ordered `Block` list back into clean Markdown.
/// Explicit block IDs (`^id`) are written only when `has_explicit_id == true` (lazy materialization).
pub fn serialize_document_to_markdown(doc: &Document, blocks: &[Block]) -> String {
    let mut out = String::new();

    if !doc.frontmatter.is_empty() {
        out.push_str("---\n");
        for (k, v) in &doc.frontmatter {
            out.push_str(&format!("{}: {}\n", k, format_yaml_value(v)));
        }
        out.push_str("---\n\n");
    }

    for (idx, block) in blocks.iter().enumerate() {
        let indent = "  ".repeat(block.depth as usize);
        let id_suffix = if block.has_explicit_id {
            format!(" ^{}", block.id)
        } else {
            String::new()
        };

        let rendered = match block.block_type {
            BlockType::Heading => {
                let level = block.heading_level.unwrap_or(1).clamp(1, 6) as usize;
                let hashes = "#".repeat(level);
                format!("{} {}{}", hashes, block.raw_content.trim(), id_suffix)
            }
            BlockType::ListItem => {
                format_indented_lines(&indent, "- ", &block.raw_content, &id_suffix)
            }
            BlockType::TaskItem => {
                let marker = block
                    .task
                    .as_ref()
                    .map(|t| t.status.to_checkbox_marker())
                    .unwrap_or("[ ]");
                let prefix = format!("- {} ", marker);
                format_indented_lines(&indent, &prefix, &block.raw_content, &id_suffix)
            }
            BlockType::CodeBlock => {
                let lang = block.code_lang.as_deref().unwrap_or("");
                format!(
                    "{}```{}\n{}\n{}```{}",
                    indent, lang, block.raw_content, indent, id_suffix
                )
            }
            BlockType::Quote | BlockType::Callout => {
                let mut lines: Vec<String> = block
                    .raw_content
                    .lines()
                    .map(|l| format!("{}> {}", indent, l))
                    .collect();
                if let Some(last) = lines.last_mut() {
                    last.push_str(&id_suffix);
                }
                lines.join("\n")
            }
            BlockType::Divider => format!("{}---", indent),
            BlockType::Paragraph => {
                let mut lines: Vec<String> = block
                    .raw_content
                    .lines()
                    .map(|l| format!("{}{}", indent, l))
                    .collect();
                if lines.is_empty() {
                    lines.push(indent.clone());
                }
                if let Some(last) = lines.last_mut() {
                    last.push_str(&id_suffix);
                }
                lines.join("\n")
            }
        };

        out.push_str(&rendered);
        out.push('\n');

        // Keep consecutive list/task items tight; separate other blocks by a blank line.
        let is_list_like = matches!(block.block_type, BlockType::ListItem | BlockType::TaskItem);
        let next_is_list_like = blocks
            .get(idx + 1)
            .map(|b| matches!(b.block_type, BlockType::ListItem | BlockType::TaskItem))
            .unwrap_or(false);

        if idx + 1 < blocks.len() && !(is_list_like && next_is_list_like) {
            out.push('\n');
        }
    }

    out
}

fn format_indented_lines(indent: &str, prefix: &str, content: &str, id_suffix: &str) -> String {
    let raw_lines: Vec<&str> = content.lines().collect();
    if raw_lines.is_empty() {
        return format!("{}{}{}", indent, prefix, id_suffix);
    }
    let mut lines = Vec::with_capacity(raw_lines.len());
    for (idx, line) in raw_lines.iter().enumerate() {
        if idx == 0 {
            lines.push(format!("{}{}{}", indent, prefix, line));
        } else {
            lines.push(format!("{}  {}", indent, line));
        }
    }
    if let Some(last) = lines.last_mut() {
        last.push_str(id_suffix);
    }
    lines.join("\n")
}

fn format_yaml_value(val: &Value) -> String {
    match val {
        Value::String(s) => {
            if s.contains(':') || s.contains('#') || s.starts_with('[') {
                format!("\"{}\"", s.replace('"', "\\\""))
            } else {
                s.clone()
            }
        }
        Value::Array(arr) => {
            let items: Vec<String> = arr.iter().map(format_yaml_value).collect();
            format!("[{}]", items.join(", "))
        }
        other => other.to_string(),
    }
}

fn resolve_parent(stack: &mut Vec<(u32, String)>, depth: u32, block_id: &str) -> Option<String> {
    while let Some((d, _)) = stack.last() {
        if *d >= depth {
            stack.pop();
        } else {
            break;
        }
    }
    let parent = stack.last().map(|(_, id)| id.clone());
    stack.push((depth, block_id.to_string()));
    parent
}

fn count_leading_spaces(line: &str) -> usize {
    let mut spaces = 0usize;
    for ch in line.chars() {
        match ch {
            ' ' => spaces += 1,
            '\t' => spaces += 2,
            _ => break,
        }
    }
    spaces
}

fn parse_frontmatter(markdown: &str) -> (BTreeMap<String, Value>, usize) {
    let mut map = BTreeMap::new();
    let trimmed_start = markdown.strip_prefix("---\n").or_else(|| markdown.strip_prefix("---\r\n"));
    let Some(after_open) = trimmed_start else {
        return (map, 0);
    };

    let open_len = markdown.len() - after_open.len();
    let mut offset = 0usize;
    let mut current_list_key: Option<String> = None;

    for line in after_open.split_inclusive('\n') {
        let trimmed = line.trim();
        offset += line.len();
        if trimmed == "---" || trimmed == "..." {
            return (map, open_len + offset);
        }
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some(item) = trimmed.strip_prefix("- ") {
            if let Some(ref key) = current_list_key {
                let entry = map
                    .entry(key.clone())
                    .or_insert_with(|| Value::Array(Vec::new()));
                if let Value::Array(arr) = entry {
                    arr.push(parse_scalar_yaml(item.trim()));
                }
            }
            continue;
        }
        if let Some((k, v)) = trimmed.split_once(':') {
            let key = k.trim().to_string();
            let val_str = v.trim();
            if val_str.is_empty() {
                current_list_key = Some(key.clone());
                map.insert(key, Value::Array(Vec::new()));
            } else {
                current_list_key = None;
                map.insert(key, parse_yaml_inline_value(val_str));
            }
        }
    }

    (BTreeMap::new(), 0)
}

fn parse_yaml_inline_value(raw: &str) -> Value {
    if raw.starts_with('[') && raw.ends_with(']') {
        let inner = &raw[1..raw.len() - 1];
        let items = inner
            .split(',')
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(parse_scalar_yaml)
            .collect();
        Value::Array(items)
    } else {
        parse_scalar_yaml(raw)
    }
}

fn parse_scalar_yaml(raw: &str) -> Value {
    let unquoted = raw
        .strip_prefix('"')
        .and_then(|s| s.strip_suffix('"'))
        .or_else(|| raw.strip_prefix('\'').and_then(|s| s.strip_suffix('\'')))
        .unwrap_or(raw);

    if unquoted == "true" {
        return Value::Bool(true);
    }
    if unquoted == "false" {
        return Value::Bool(false);
    }
    if raw == unquoted {
        if let Ok(n) = unquoted.parse::<i64>() {
            return Value::Number(n.into());
        }
        if let Ok(f) = unquoted.parse::<f64>() {
            if let Some(num) = serde_json::Number::from_f64(f) {
                return Value::Number(num);
            }
        }
    }
    Value::String(unquoted.to_string())
}

fn collect_frontmatter_tags(val: &Value, out: &mut BTreeSet<String>) {
    match val {
        Value::String(s) => {
            for part in s.split(|c: char| c == ',' || c.is_whitespace()) {
                let clean = part.trim().trim_start_matches('#');
                if !clean.is_empty() {
                    out.insert(clean.to_string());
                }
            }
        }
        Value::Array(arr) => {
            for item in arr {
                collect_frontmatter_tags(item, out);
            }
        }
        _ => {}
    }
}

fn is_divider(trimmed: &str) -> bool {
    if trimmed.len() < 3 {
        return false;
    }
    let ch = trimmed.chars().next().unwrap_or(' ');
    matches!(ch, '-' | '*' | '_') && trimmed.chars().all(|c| c == ch || c == ' ')
}

fn parse_heading(trimmed: &str) -> Option<(u8, &str)> {
    let hashes = trimmed.bytes().take_while(|&b| b == b'#').count();
    if hashes == 0 || hashes > 6 {
        return None;
    }
    let rest = &trimmed[hashes..];
    if rest.starts_with(' ') || rest.starts_with('\t') {
        Some((hashes as u8, rest.trim_start()))
    } else {
        None
    }
}

fn parse_list_or_task_prefix(trimmed: &str) -> Option<(bool, Option<TaskStatus>, &str)> {
    let rest = trimmed
        .strip_prefix("- ")
        .or_else(|| trimmed.strip_prefix("* "))
        .or_else(|| trimmed.strip_prefix("+ "))
        .or_else(|| {
            // Ordered list: `1. `
            let digits = trimmed.bytes().take_while(|b| b.is_ascii_digit()).count();
            if digits > 0 && trimmed[digits..].starts_with(". ") {
                Some(&trimmed[digits + 2..])
            } else {
                None
            }
        })?;

    // Check Markdown task checkboxes
    if let Some(after) = rest.strip_prefix("[ ] ") {
        return Some((true, Some(TaskStatus::Todo), after));
    }
    if rest == "[ ]" {
        return Some((true, Some(TaskStatus::Todo), ""));
    }
    if let Some(after) = rest.strip_prefix("[/] ") {
        return Some((true, Some(TaskStatus::Doing), after));
    }
    if let Some(after) = rest.strip_prefix("[x] ").or_else(|| rest.strip_prefix("[X] ")) {
        return Some((true, Some(TaskStatus::Done), after));
    }
    if let Some(after) = rest.strip_prefix("[-] ") {
        return Some((true, Some(TaskStatus::Canceled), after));
    }

    // Check Logseq keywords
    if let Some(after) = rest.strip_prefix("TODO ") {
        return Some((true, Some(TaskStatus::Todo), after));
    }
    if let Some(after) = rest.strip_prefix("DOING ") {
        return Some((true, Some(TaskStatus::Doing), after));
    }
    if let Some(after) = rest.strip_prefix("DONE ") {
        return Some((true, Some(TaskStatus::Done), after));
    }
    if let Some(after) = rest.strip_prefix("CANCELED ") {
        return Some((true, Some(TaskStatus::Canceled), after));
    }

    Some((false, None, rest))
}

fn extract_trailing_block_id(raw: &mut String) -> Option<String> {
    let trimmed = raw.trim_end();
    // Support Obsidian-style ` ^block-id` at the end of a block
    if let Some(pos) = trimmed.rfind(" ^") {
        let candidate = &trimmed[pos + 2..];
        if !candidate.is_empty()
            && candidate.len() <= 48
            && candidate
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        {
            let id = candidate.to_string();
            raw.truncate(pos);
            *raw = raw.trim_end().to_string();
            return Some(id);
        }
    }
    // Support ` <!-- id: xyz -->`
    if let Some(start) = trimmed.rfind("<!-- id:") {
        if let Some(end_rel) = trimmed[start..].find("-->") {
            let inner = trimmed[start + 8..start + end_rel].trim();
            if !inner.is_empty()
                && inner
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
            {
                let id = inner.to_string();
                let before = trimmed[..start].trim_end().to_string();
                *raw = before;
                return Some(id);
            }
        }
    }
    None
}

/// Extracts `key:: value` inline properties, `#tags`, `[[Wiki-Links]]`, `![[Embeds]]`, and `((Block-Refs))`.
pub fn extract_inline_semantics(
    raw: &str,
) -> (BTreeMap<String, String>, Vec<String>, Vec<ExtractedLink>) {
    let mut properties = BTreeMap::new();
    let mut tag_set = BTreeSet::new();
    let mut links = Vec::new();
    let mut seen_links = BTreeSet::new();

    // 1. Line-level and bracketed `[key:: val]` properties
    for line in raw.lines() {
        let t = line.trim();
        if let Some((k, v)) = parse_property_assignment(t) {
            properties.insert(k, v);
        }
    }
    // Bracketed inline properties `[key:: value]`
    let bytes = raw.as_bytes();
    let mut idx = 0usize;
    while idx < bytes.len() {
        if bytes[idx] == b'[' && !bytes[idx..].starts_with(b"[[") {
            if let Some(close_rel) = raw[idx + 1..].find(']') {
                let inner = &raw[idx + 1..idx + 1 + close_rel];
                if !inner.contains('[') && bytes.get(idx + 1 + close_rel + 1) != Some(&b'(') {
                    if let Some((k, v)) = parse_property_assignment(inner) {
                        properties.insert(k, v);
                    }
                }
                idx += close_rel + 2;
                continue;
            }
        }
        idx += 1;
    }

    // 2. Embeds `![[...]]` & Wiki-Links `[[...]]`
    let mut pos = 0usize;
    while pos < bytes.len() {
        if bytes[pos] == b'!' && bytes[pos..].starts_with(b"![[") {
            if let Some(end_rel) = raw[pos + 3..].find("]]") {
                let target_full = &raw[pos + 3..pos + 3 + end_rel];
                let target = target_full.split('|').next().unwrap_or(target_full).trim();
                if !target.is_empty() && seen_links.insert((LinkType::Embed.as_str(), target.to_string())) {
                    links.push(ExtractedLink {
                        target_raw: target.to_string(),
                        link_type: LinkType::Embed,
                    });
                }
                pos += 3 + end_rel + 2;
                continue;
            }
        } else if bytes[pos] == b'[' && bytes[pos..].starts_with(b"[[") {
            if let Some(end_rel) = raw[pos + 2..].find("]]") {
                let target_full = &raw[pos + 2..pos + 2 + end_rel];
                let target = target_full
                    .split('|')
                    .next()
                    .unwrap_or(target_full)
                    .split('#')
                    .next()
                    .unwrap_or(target_full)
                    .trim();
                if !target.is_empty()
                    && seen_links.insert((LinkType::WikiLink.as_str(), target.to_string()))
                {
                    links.push(ExtractedLink {
                        target_raw: target.to_string(),
                        link_type: LinkType::WikiLink,
                    });
                }
                pos += 2 + end_rel + 2;
                continue;
            }
        } else if bytes[pos] == b'(' && bytes[pos..].starts_with(b"((") {
            if let Some(end_rel) = raw[pos + 2..].find("))") {
                let target = raw[pos + 2..pos + 2 + end_rel].trim();
                if !target.is_empty()
                    && !target.contains(' ')
                    && seen_links.insert((LinkType::BlockRef.as_str(), target.to_string()))
                {
                    links.push(ExtractedLink {
                        target_raw: target.to_string(),
                        link_type: LinkType::BlockRef,
                    });
                }
                pos += 2 + end_rel + 2;
                continue;
            }
        }
        pos += 1;
    }

    // 3. Tags `#tag` (supports nested `#project/rust`)
    for (byte_idx, ch) in raw.char_indices() {
        if ch == '#' {
            let prev_ok = byte_idx == 0
                || raw[..byte_idx]
                    .chars()
                    .next_back()
                    .map(|c| c.is_whitespace() || matches!(c, '(' | '[' | ',' | ':'))
                    .unwrap_or(true);
            if !prev_ok {
                continue;
            }
            let after = &raw[byte_idx + 1..];
            let mut tag_len = 0usize;
            for (i, tc) in after.char_indices() {
                if i == 0 && !tc.is_alphabetic() {
                    break;
                }
                if tc.is_alphanumeric() || matches!(tc, '-' | '_' | '/') {
                    tag_len = i + tc.len_utf8();
                } else {
                    break;
                }
            }
            if tag_len > 0 {
                let tag = after[..tag_len].trim_end_matches('/').to_string();
                if !tag.is_empty() {
                    tag_set.insert(tag.clone());
                    if seen_links.insert((LinkType::Tag.as_str(), tag.clone())) {
                        links.push(ExtractedLink {
                            target_raw: tag,
                            link_type: LinkType::Tag,
                        });
                    }
                }
            }
        }
    }

    // Property relations (`project:: [[Alpha]]`)
    for val in properties.values() {
        if let Some(start) = val.find("[[") {
            if let Some(end) = val[start + 2..].find("]]") {
                let target = val[start + 2..start + 2 + end].trim().to_string();
                if !target.is_empty()
                    && seen_links.insert((LinkType::PropertyRel.as_str(), target.clone()))
                {
                    links.push(ExtractedLink {
                        target_raw: target,
                        link_type: LinkType::PropertyRel,
                    });
                }
            }
        }
    }

    (properties, tag_set.into_iter().collect(), links)
}

fn parse_property_assignment(text: &str) -> Option<(String, String)> {
    let (k, v) = text.split_once("::")?;
    let key = k.trim();
    let val = v.trim();
    if key.is_empty()
        || key.len() > 40
        || !key
            .chars()
            .all(|c| c.is_alphanumeric() || c == '_' || c == '-')
    {
        return None;
    }
    Some((key.to_string(), val.to_string()))
}

fn build_task_metadata(
    status: TaskStatus,
    raw: &str,
    properties: &BTreeMap<String, String>,
) -> TaskMetadata {
    let priority = properties
        .get("priority")
        .and_then(|v| match v.to_lowercase().as_str() {
            "1" | "high" | "urgent" | "a" => Some(1),
            "2" | "medium" | "b" => Some(2),
            "3" | "low" | "c" => Some(3),
            "4" => Some(4),
            _ => None,
        })
        .or_else(|| {
            if raw.contains("[#A]") || raw.contains("⏫") {
                Some(1)
            } else if raw.contains("[#B]") || raw.contains("🔼") {
                Some(2)
            } else if raw.contains("[#C]") || raw.contains("🔽") {
                Some(3)
            } else {
                None
            }
        });

    let scheduled_at = properties
        .get("scheduled")
        .or_else(|| properties.get("scheduled_at"))
        .cloned()
        .or_else(|| extract_emoji_date(raw, "⏳"));

    let deadline_at = properties
        .get("deadline")
        .or_else(|| properties.get("due"))
        .cloned()
        .or_else(|| extract_emoji_date(raw, "📅"));

    let recurrence = properties
        .get("repeat")
        .or_else(|| properties.get("recurrence"))
        .cloned();

    TaskMetadata {
        status,
        priority,
        scheduled_at,
        deadline_at,
        recurrence,
    }
}

fn extract_emoji_date(raw: &str, emoji: &str) -> Option<String> {
    let idx = raw.find(emoji)?;
    let rest = raw[idx + emoji.len()..].trim_start();
    let candidate: String = rest.chars().take(10).collect();
    if candidate.len() == 10
        && candidate.as_bytes()[4] == b'-'
        && candidate.as_bytes()[7] == b'-'
    {
        Some(candidate)
    } else {
        None
    }
}

/// Removes Markdown syntax noise so full-text search indexes clean human-readable text.
pub fn strip_markdown_syntax(raw: &str) -> String {
    let mut s = raw.replace("![[", "").replace("[[", "").replace("]]", "");
    s = s.replace("**", "").replace("__", "").replace("`", "");
    s.lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn derive_title(
    rel_path: &str,
    frontmatter: &BTreeMap<String, Value>,
    blocks: &[ParsedBlock],
) -> String {
    if let Some(title) = frontmatter.get("title").and_then(|v| v.as_str()) {
        if !title.trim().is_empty() {
            return title.trim().to_string();
        }
    }
    for pb in blocks {
        if pb.block.block_type == BlockType::Heading && pb.block.heading_level == Some(1) {
            if !pb.block.plain_text.is_empty() {
                return pb.block.plain_text.clone();
            }
        }
    }
    std::path::Path::new(rel_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(rel_path)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_hybrid_document_with_lazy_ids_tasks_and_links() {
        let md = r#"---
tags: [rust, architecture]
status: active
---

# OxideVault Core

Normaler Langform-Absatz mit [[CRDT Sync]] und ((blk-sync01)). ^blk-intro

- Erster Listenpunkt mit #projekt/core
  - Verschachtelter Unterpunkt mit [author:: Alice]
- [ ] Benchmark mit 100k Blöcken testen
  priority:: 1
  deadline:: 2026-11-25
"#;

        let parsed = parse_markdown_document("Core.md", md, 100, 200);
        assert_eq!(parsed.document.title, "OxideVault Core");
        assert!(parsed.document.tags.contains(&"rust".to_string()));
        assert!(parsed.document.tags.contains(&"projekt/core".to_string()));
        assert_eq!(parsed.blocks.len(), 5);

        // Second block has explicit ^blk-intro
        assert_eq!(parsed.blocks[1].block.id, "blk-intro");
        assert!(parsed.blocks[1].block.has_explicit_id);
        assert_eq!(parsed.blocks[1].links.len(), 2);

        // Nested child block inherits parent_block_id from depth 0 list item
        assert_eq!(parsed.blocks[3].block.depth, 1);
        assert_eq!(
            parsed.blocks[3].block.parent_block_id.as_deref(),
            Some(parsed.blocks[2].block.id.as_str())
        );
        assert_eq!(
            parsed.blocks[3].block.properties.get("author").map(|s| s.as_str()),
            Some("Alice")
        );

        // Task block
        let task_blk = &parsed.blocks[4].block;
        assert_eq!(task_blk.block_type, BlockType::TaskItem);
        let task = task_blk.task.as_ref().unwrap();
        assert_eq!(task.status, TaskStatus::Todo);
        assert_eq!(task.priority, Some(1));
        assert_eq!(task.deadline_at.as_deref(), Some("2026-11-25"));
    }

    #[test]
    fn roundtrip_preserves_lazy_ids_only_when_explicit() {
        let md = "# Test\n\nNormaler Absatz ohne ID.\n\nReferenzierter Absatz. ^my-id\n";
        let parsed = parse_markdown_document("Test.md", md, 1, 1);
        let blocks: Vec<Block> = parsed.blocks.into_iter().map(|pb| pb.block).collect();
        let serialized = serialize_document_to_markdown(&parsed.document, &blocks);
        assert!(!serialized.contains("b-"));
        assert!(serialized.contains("Referenzierter Absatz. ^my-id"));
    }
}
