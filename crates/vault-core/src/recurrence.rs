use crate::model::{Block, TaskStatus};
use chrono::{Days, Local, Months, NaiveDate};

/// Computes the next occurrence date for a recurring task rule such as
/// `daily`, `weekly`, `monthly`, `yearly`, `every 3d`, `every 2w`, `every 1m`.
pub fn compute_next_recurrence_date(base_date: NaiveDate, recurrence: &str) -> Option<NaiveDate> {
    let normalized = recurrence.trim().to_lowercase();
    if normalized.is_empty() {
        return None;
    }

    match normalized.as_str() {
        "daily" | "every day" | "1d" => return base_date.checked_add_days(Days::new(1)),
        "weekly" | "every week" | "1w" => return base_date.checked_add_days(Days::new(7)),
        "monthly" | "every month" | "1m" => return base_date.checked_add_months(Months::new(1)),
        "yearly" | "every year" | "1y" => return base_date.checked_add_months(Months::new(12)),
        _ => {}
    }

    let rest = normalized
        .strip_prefix("every ")
        .unwrap_or(&normalized)
        .trim();
    let digits_len = rest.bytes().take_while(|b| b.is_ascii_digit()).count();
    if digits_len == 0 {
        return None;
    }
    let count: u64 = rest[..digits_len].parse().ok()?;
    if count == 0 {
        return None;
    }
    let unit = rest[digits_len..].trim();
    match unit {
        "d" | "day" | "days" => base_date.checked_add_days(Days::new(count)),
        "w" | "week" | "weeks" => base_date.checked_add_days(Days::new(count.saturating_mul(7))),
        "m" | "month" | "months" => u32::try_from(count)
            .ok()
            .and_then(|m| base_date.checked_add_months(Months::new(m))),
        "y" | "year" | "years" => u32::try_from(count.saturating_mul(12))
            .ok()
            .and_then(|m| base_date.checked_add_months(Months::new(m))),
        _ => None,
    }
}

/// Builds the next open TODO task block derived from a completed recurring task block.
pub fn build_next_recurring_task_block(completed: &Block, recurrence: &str) -> Option<Block> {
    let task = completed.task.as_ref()?;
    let today = Local::now().date_naive();

    let parsed_sched = task
        .scheduled_at
        .as_deref()
        .and_then(|s| NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d").ok());
    let parsed_dead = task
        .deadline_at
        .as_deref()
        .and_then(|s| NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d").ok());

    let primary_base = parsed_sched.or(parsed_dead).unwrap_or(today);
    let next_primary = compute_next_recurrence_date(primary_base, recurrence)?;

    let mut next_block = completed.clone();
    next_block.has_explicit_id = false;
    let mut raw = completed.raw_content.clone();

    let next_sched = parsed_sched.and_then(|d| compute_next_recurrence_date(d, recurrence));
    let next_dead = parsed_dead.and_then(|d| compute_next_recurrence_date(d, recurrence));

    if let (Some(old_str), Some(new_d)) = (task.scheduled_at.as_deref(), next_sched) {
        let new_str = new_d.format("%Y-%m-%d").to_string();
        raw = replace_date_property(&raw, &["scheduled", "scheduled_at"], old_str, &new_str);
        if let Some(ref mut t) = next_block.task {
            t.scheduled_at = Some(new_str);
        }
    }

    if let (Some(old_str), Some(new_d)) = (task.deadline_at.as_deref(), next_dead) {
        let new_str = new_d.format("%Y-%m-%d").to_string();
        raw = replace_date_property(&raw, &["deadline", "due"], old_str, &new_str);
        if let Some(ref mut t) = next_block.task {
            t.deadline_at = Some(new_str);
        }
    }

    if parsed_sched.is_none() && parsed_dead.is_none() {
        let next_str = next_primary.format("%Y-%m-%d").to_string();
        if !raw.ends_with('\n') && !raw.is_empty() {
            raw.push('\n');
        }
        raw.push_str(&format!("scheduled:: {}", next_str));
        if let Some(ref mut t) = next_block.task {
            t.scheduled_at = Some(next_str);
        }
    }

    next_block.raw_content = raw;
    if let Some(ref mut t) = next_block.task {
        t.status = TaskStatus::Todo;
    }
    Some(next_block)
}

/// Replaces a date property value (`key:: old_date` or inline `[key:: old_date]`) in a raw block string.
pub fn replace_date_property(raw: &str, keys: &[&str], old_date: &str, new_date: &str) -> String {
    let mut updated_lines = Vec::new();
    let mut replaced = false;
    for line in raw.lines() {
        let trimmed = line.trim();
        let mut new_line = line.to_string();
        for key in keys {
            let prefix = format!("{}::", key);
            if trimmed.to_lowercase().starts_with(&prefix) && line.contains(old_date) {
                new_line = line.replacen(old_date, new_date, 1);
                replaced = true;
                break;
            }
        }
        if !replaced {
            // Also support inline bracketed `[scheduled:: 2026-11-23]` or emoji dates
            for key in keys {
                let marker = format!("{}:: {}", key, old_date);
                if new_line.contains(&marker) {
                    new_line = new_line.replacen(&marker, &format!("{}:: {}", key, new_date), 1);
                    replaced = true;
                    break;
                }
            }
        }
        updated_lines.push(new_line);
    }
    if replaced {
        updated_lines.join("\n")
    } else {
        raw.replacen(old_date, new_date, 1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{BlockType, TaskMetadata};
    use std::collections::BTreeMap;

    fn sample_task_block(raw: &str, scheduled: Option<&str>, deadline: Option<&str>) -> Block {
        Block {
            id: "blk-1".to_string(),
            doc_id: "doc-1".to_string(),
            parent_block_id: None,
            depth: 0,
            sort_order: 0.0,
            block_type: BlockType::TaskItem,
            heading_level: None,
            code_lang: None,
            has_explicit_id: true,
            raw_content: raw.to_string(),
            plain_text: "Review".to_string(),
            properties: BTreeMap::new(),
            tags: Vec::new(),
            collapsed: false,
            task: Some(TaskMetadata {
                status: TaskStatus::Done,
                priority: Some(1),
                scheduled_at: scheduled.map(|s| s.to_string()),
                deadline_at: deadline.map(|s| s.to_string()),
                recurrence: Some("weekly".to_string()),
            }),
            updated_at: 0,
        }
    }

    #[test]
    fn computes_next_recurrence_date_across_rules() {
        let base = NaiveDate::from_ymd_opt(2026, 1, 31).unwrap();
        assert_eq!(
            compute_next_recurrence_date(base, "daily"),
            NaiveDate::from_ymd_opt(2026, 2, 1)
        );
        assert_eq!(
            compute_next_recurrence_date(base, "every 3d"),
            NaiveDate::from_ymd_opt(2026, 2, 3)
        );
        assert_eq!(
            compute_next_recurrence_date(base, "weekly"),
            NaiveDate::from_ymd_opt(2026, 2, 7)
        );
        assert_eq!(
            compute_next_recurrence_date(base, "every 2 weeks"),
            NaiveDate::from_ymd_opt(2026, 2, 14)
        );
        // Month-end clamping: Jan 31 + 1 month -> Feb 28
        assert_eq!(
            compute_next_recurrence_date(base, "monthly"),
            NaiveDate::from_ymd_opt(2026, 2, 28)
        );
        assert_eq!(
            compute_next_recurrence_date(base, "every 2m"),
            NaiveDate::from_ymd_opt(2026, 3, 31)
        );
        assert_eq!(
            compute_next_recurrence_date(base, "yearly"),
            NaiveDate::from_ymd_opt(2027, 1, 31)
        );
        assert_eq!(
            compute_next_recurrence_date(base, "every 2 years"),
            NaiveDate::from_ymd_opt(2028, 1, 31)
        );
        assert_eq!(compute_next_recurrence_date(base, ""), None);
        assert_eq!(compute_next_recurrence_date(base, "every 0d"), None);
        assert_eq!(compute_next_recurrence_date(base, "nonsense"), None);
    }

    #[test]
    fn replaces_multiline_and_inline_date_properties() {
        let multiline = "Weekly review\n  scheduled:: 2026-11-23\n  deadline:: 2026-11-25";
        let updated =
            replace_date_property(multiline, &["scheduled", "scheduled_at"], "2026-11-23", "2026-11-30");
        assert!(updated.contains("scheduled:: 2026-11-30"));
        assert!(updated.contains("deadline:: 2026-11-25"));

        let inline = "Weekly review [due:: 2026-11-25] #ops";
        let updated_inline =
            replace_date_property(inline, &["deadline", "due"], "2026-11-25", "2026-12-02");
        assert_eq!(updated_inline, "Weekly review [due:: 2026-12-02] #ops");
    }

    #[test]
    fn builds_next_recurring_block_with_shifted_dates_and_todo_status() {
        let blk = sample_task_block(
            "Weekly review\n  scheduled:: 2026-11-23\n  deadline:: 2026-11-25\n  repeat:: weekly",
            Some("2026-11-23"),
            Some("2026-11-25"),
        );

        let next = build_next_recurring_task_block(&blk, "weekly").expect("next block");
        assert!(!next.has_explicit_id);
        assert_eq!(next.task.as_ref().unwrap().status, TaskStatus::Todo);
        assert_eq!(
            next.task.as_ref().unwrap().scheduled_at.as_deref(),
            Some("2026-11-30")
        );
        assert_eq!(
            next.task.as_ref().unwrap().deadline_at.as_deref(),
            Some("2026-12-02")
        );
        assert!(next.raw_content.contains("scheduled:: 2026-11-30"));
        assert!(next.raw_content.contains("deadline:: 2026-12-02"));
    }

    #[test]
    fn builds_next_recurring_block_without_existing_dates_appends_scheduled() {
        let blk = sample_task_block("Daily standup\n  repeat:: daily", None, None);
        let next = build_next_recurring_task_block(&blk, "daily").expect("next block");
        let expected = compute_next_recurrence_date(Local::now().date_naive(), "daily")
            .unwrap()
            .format("%Y-%m-%d")
            .to_string();
        assert_eq!(
            next.task.as_ref().unwrap().scheduled_at.as_deref(),
            Some(expected.as_str())
        );
        assert!(next
            .raw_content
            .contains(&format!("scheduled:: {}", expected)));
    }
}
