/// Formats a scalar value for safe insertion into YAML frontmatter.
pub fn format_frontmatter_scalar(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return "\"\"".to_string();
    }
    if trimmed.starts_with('[') && trimmed.ends_with(']') {
        return trimmed.to_string();
    }
    if trimmed.contains(':')
        || trimmed.contains('#')
        || trimmed.starts_with('[')
        || trimmed.starts_with('{')
        || trimmed.starts_with('"')
    {
        format!("\"{}\"", trimmed.replace('"', "\\\""))
    } else {
        trimmed.to_string()
    }
}

/// Inserts or updates a YAML frontmatter key in `raw_md` while preserving the document body verbatim.
pub fn upsert_frontmatter_property(raw_md: &str, key: &str, value: &str) -> String {
    let formatted = format_frontmatter_scalar(value);
    let new_entry = format!("{}: {}", key, formatted);

    let open_prefix = if raw_md.starts_with("---\r\n") {
        Some(("---\r\n", "\r\n"))
    } else if raw_md.starts_with("---\n") {
        Some(("---\n", "\n"))
    } else {
        None
    };

    if let Some((open_delim, nl)) = open_prefix {
        let after_open = &raw_md[open_delim.len()..];
        let mut fm_lines: Vec<&str> = Vec::new();
        let mut offset = 0usize;
        let mut found_close = false;

        for line in after_open.split_inclusive('\n') {
            let trimmed = line.trim();
            offset += line.len();
            if trimmed == "---" || trimmed == "..." {
                found_close = true;
                break;
            }
            fm_lines.push(line.trim_end_matches(['\r', '\n']));
        }

        if found_close {
            let body = &after_open[offset..];
            let mut out_lines: Vec<String> = Vec::with_capacity(fm_lines.len() + 1);
            let mut updated = false;
            let mut skip_list_items = false;

            for line in fm_lines {
                let trimmed = line.trim();
                if skip_list_items {
                    if trimmed.starts_with("- ") {
                        continue;
                    }
                    skip_list_items = false;
                }
                if !updated {
                    if let Some((k, rest)) = trimmed.split_once(':') {
                        if k.trim() == key {
                            out_lines.push(new_entry.clone());
                            updated = true;
                            if rest.trim().is_empty() {
                                skip_list_items = true;
                            }
                            continue;
                        }
                    }
                }
                out_lines.push(line.to_string());
            }

            if !updated {
                out_lines.push(new_entry);
            }

            let mut result = String::with_capacity(raw_md.len() + 64);
            result.push_str("---");
            result.push_str(nl);
            for line in out_lines {
                result.push_str(&line);
                result.push_str(nl);
            }
            result.push_str("---");
            result.push_str(nl);
            result.push_str(body);
            return result;
        }
    }

    format!("---\n{}\n---\n\n{}", new_entry, raw_md)
}

/// Rewrites `[[Target]]`, `[[Target|Alias]]`, and `[[Target#Heading]]` wiki-links in Markdown
/// when a note is renamed, matching case-insensitively against any of `old_targets`.
pub fn rewrite_wiki_links_in_markdown(
    markdown: &str,
    old_targets: &[String],
    new_target: &str,
) -> String {
    let lower_targets: Vec<String> = old_targets
        .iter()
        .map(|t| t.trim().to_lowercase())
        .filter(|t| !t.is_empty())
        .collect();
    if lower_targets.is_empty() {
        return markdown.to_string();
    }

    let mut out = String::with_capacity(markdown.len());
    let mut rest = markdown;

    while let Some(start) = rest.find("[[") {
        out.push_str(&rest[..start]);
        let after_open = &rest[start + 2..];
        let Some(end) = after_open.find("]]") else {
            out.push_str(&rest[start..]);
            return out;
        };
        let inner = &after_open[..end];
        let (target_and_anchor, alias_part) = match inner.split_once('|') {
            Some((lhs, rhs)) => (lhs, Some(rhs)),
            None => (inner, None),
        };
        let (target_part, anchor_part) = match target_and_anchor.split_once('#') {
            Some((lhs, rhs)) => (lhs, Some(rhs)),
            None => (target_and_anchor, None),
        };

        let normalized_target = target_part.trim().trim_end_matches(".md").to_lowercase();
        if lower_targets.iter().any(|old| old == &normalized_target) {
            out.push_str("[[");
            out.push_str(new_target);
            if let Some(anchor) = anchor_part {
                out.push('#');
                out.push_str(anchor);
            }
            if let Some(alias) = alias_part {
                out.push('|');
                out.push_str(alias);
            }
            out.push_str("]]");
        } else {
            out.push_str("[[");
            out.push_str(inner);
            out.push_str("]]");
        }
        rest = &after_open[end + 2..];
    }

    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_frontmatter_scalars_safely() {
        assert_eq!(format_frontmatter_scalar("active"), "active");
        assert_eq!(format_frontmatter_scalar(""), "\"\"");
        assert_eq!(format_frontmatter_scalar("[a, b]"), "[a, b]");
        assert_eq!(
            format_frontmatter_scalar("key: value"),
            "\"key: value\""
        );
        assert_eq!(
            format_frontmatter_scalar("tag #1"),
            "\"tag #1\""
        );
        assert_eq!(
            format_frontmatter_scalar("\"quoted\""),
            "\"\\\"quoted\\\"\""
        );
    }

    #[test]
    fn upserts_updates_and_prepends_frontmatter_preserving_body() {
        let with_fm = "---\ntags:\n  - old1\n  - old2\nstatus: draft\n---\n\n# Body\n\nKeep me.\n";
        let updated_status = upsert_frontmatter_property(with_fm, "status", "done");
        assert!(updated_status.contains("status: done\n"));
        assert!(updated_status.ends_with("\n# Body\n\nKeep me.\n"));

        let replaced_list = upsert_frontmatter_property(with_fm, "tags", "[rust, notes]");
        assert!(replaced_list.contains("tags: [rust, notes]\n"));
        assert!(!replaced_list.contains("- old1"));
        assert!(replaced_list.contains("status: draft\n"));

        let added_key = upsert_frontmatter_property(with_fm, "owner", "Alice");
        assert!(added_key.contains("owner: Alice\n---\n"));

        let no_fm = "# Plain Note\n\nHello.\n";
        let prepended = upsert_frontmatter_property(no_fm, "mood", "calm");
        assert_eq!(prepended, "---\nmood: calm\n---\n\n# Plain Note\n\nHello.\n");

        let crlf = "---\r\nstatus: draft\r\n---\r\n\r\nBody";
        let updated_crlf = upsert_frontmatter_property(crlf, "status", "live");
        assert_eq!(updated_crlf, "---\r\nstatus: live\r\n---\r\n\r\nBody");
    }

    #[test]
    fn rewrites_wiki_links_preserving_aliases_anchors_and_other_links() {
        let md = "See [[Old]], [[old.md|Alias]], [[OLD#Intro|Sec]], [[Keep]], and [[unclosed";
        let rewritten = rewrite_wiki_links_in_markdown(md, &["Old".to_string()], "New");
        assert_eq!(
            rewritten,
            "See [[New]], [[New|Alias]], [[New#Intro|Sec]], [[Keep]], and [[unclosed"
        );

        assert_eq!(rewrite_wiki_links_in_markdown(md, &[], "New"), md);
    }
}
