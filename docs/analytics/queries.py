Q = {}

Q['A1_upload_success_rate'] = """
SELECT
  countIf(event = 'resume_upload_submitted') AS submitted,
  countIf(event = 'resume_upload_completed') AS completed,
  round(100.0 * countIf(event = 'resume_upload_completed')
        / nullIf(countIf(event = 'resume_upload_submitted'), 0), 2) AS success_rate_pct
FROM events
WHERE event IN ('resume_upload_submitted','resume_upload_completed')
  AND timestamp > now() - INTERVAL 7 DAY
"""

Q['A2_validation_error_rate'] = """
SELECT
  countIf(event = 'resume_upload_started') AS started,
  countIf(event = 'resume_upload_validation_failed') AS validation_failed,
  round(100.0 * countIf(event = 'resume_upload_validation_failed')
        / nullIf(countIf(event = 'resume_upload_started'), 0), 2) AS validation_error_rate_pct
FROM events
WHERE event IN ('resume_upload_started','resume_upload_validation_failed')
  AND timestamp > now() - INTERVAL 7 DAY
"""

Q['A3_upload_funnel_by_source'] = """
SELECT
  toString(properties.source) AS source,
  countIf(event = 'resume_upload_started')   AS s1_started,
  countIf(event = 'resume_upload_submitted') AS s2_submitted,
  countIf(event = 'resume_upload_completed') AS s3_completed,
  round(100.0 * countIf(event = 'resume_upload_completed')
        / nullIf(countIf(event = 'resume_upload_started'), 0), 2) AS overall_conversion_pct
FROM events
WHERE event IN ('resume_upload_started','resume_upload_submitted','resume_upload_completed')
  AND timestamp > now() - INTERVAL 7 DAY
GROUP BY source
ORDER BY s1_started DESC
"""

Q['A4_processing_time'] = """
SELECT
  count() AS n_real_uploads,
  round(avg(toFloat(properties.processing_time_ms)), 1) AS avg_ms,
  round(quantile(0.95)(toFloat(properties.processing_time_ms)), 1) AS p95_ms
FROM events
WHERE event = 'resume_upload_completed'
  AND toString(properties.is_duplicate) = 'false'
  AND timestamp > now() - INTERVAL 7 DAY
"""

Q['A5_parse_success_rate'] = """
SELECT
  count() AS completed,
  countIf(toFloat(properties.sections_detected) > 0) AS parsed_ok,
  round(100.0 * countIf(toFloat(properties.sections_detected) > 0)
        / nullIf(count(), 0), 2) AS parse_success_rate_pct
FROM events
WHERE event = 'resume_upload_completed'
  AND timestamp > now() - INTERVAL 7 DAY
"""

Q['A6_avg_sections_detected'] = """
SELECT round(avg(toFloat(properties.sections_detected)), 2) AS avg_sections_detected
FROM events
WHERE event = 'resume_upload_completed' AND timestamp > now() - INTERVAL 7 DAY
"""

Q['A7_avg_bullets_per_section'] = """
SELECT
  round(avg(toFloat(properties.bullets_total)), 2)    AS avg_bullets,
  round(avg(toFloat(properties.sections_detected)), 2) AS avg_sections,
  round(avg(toFloat(properties.bullets_total))
        / nullIf(avg(toFloat(properties.sections_detected)), 0), 2) AS bullets_per_section
FROM events
WHERE event = 'resume_upload_completed' AND timestamp > now() - INTERVAL 7 DAY
"""

Q['A8_avg_extracted_char_count'] = """
SELECT round(avg(toFloat(properties.extracted_char_count)), 1) AS avg_extracted_char_count
FROM events
WHERE event = 'resume_upload_completed' AND timestamp > now() - INTERVAL 7 DAY
"""

Q['A9_failure_breakdown'] = """
SELECT
  toString(properties.error_stage) AS error_stage,
  toString(properties.error_code)  AS error_code,
  count() AS failures
FROM events
WHERE event = 'resume_upload_failed' AND timestamp > now() - INTERVAL 7 DAY
GROUP BY error_stage, error_code
ORDER BY failures DESC
"""

Q['B1_export_view_rate'] = """
SELECT
  uniqIf(toString(properties.session_id), event = 'resume_upload_completed') AS completed_sessions,
  uniqIf(toString(properties.session_id), event = 'export_viewed')           AS export_viewed_sessions,
  round(100.0 * uniqIf(toString(properties.session_id), event = 'export_viewed')
        / nullIf(uniqIf(toString(properties.session_id), event = 'resume_upload_completed'), 0), 2) AS export_view_rate_pct
FROM events
WHERE event IN ('resume_upload_completed','export_viewed')
  AND timestamp > now() - INTERVAL 7 DAY
"""

Q['B2_resume_manager_visit_rate'] = """
SELECT
  uniq(toString(properties.session_id)) AS total_sessions,
  uniqIf(toString(properties.session_id), event = 'resume_manager_viewed') AS manager_sessions,
  round(100.0 * uniqIf(toString(properties.session_id), event = 'resume_manager_viewed')
        / nullIf(uniq(toString(properties.session_id)), 0), 2) AS manager_visit_rate_pct
FROM events
WHERE timestamp > now() - INTERVAL 7 DAY
"""

Q['B3_exports_link_ctr'] = """
SELECT
  toString(properties.resume_file_type) AS resume_file_type,
  count() AS clicks
FROM events
WHERE event = 'resume_exports_link_clicked' AND timestamp > now() - INTERVAL 7 DAY
GROUP BY resume_file_type
ORDER BY clicks DESC
"""

Q['B4_post_upload_cta_split'] = """
SELECT
  toString(properties.cta) AS cta,
  count() AS clicks,
  round(100.0 * count() / nullIf(sum(count()) OVER (), 0), 2) AS pct_of_clicks
FROM events
WHERE event = 'resume_upload_cta_clicked' AND timestamp > now() - INTERVAL 7 DAY
GROUP BY cta
ORDER BY clicks DESC
"""

Q['B5_export_generation_rate'] = """
SELECT
  count() AS completed,
  countIf(toString(properties.export_id) != '' AND toString(properties.export_id) != 'null') AS with_export_id,
  round(100.0 * countIf(toString(properties.export_id) != '' AND toString(properties.export_id) != 'null')
        / nullIf(count(), 0), 2) AS export_generation_rate_pct
FROM events
WHERE event = 'resume_upload_completed' AND timestamp > now() - INTERVAL 7 DAY
"""

Q['C1_return_upload_rate_30d'] = """
SELECT
  count() AS uploaders_30d,
  countIf(uploads >= 2) AS returning_uploaders,
  round(100.0 * countIf(uploads >= 2) / nullIf(count(), 0), 2) AS return_upload_rate_pct
FROM (
  SELECT person_id, count() AS uploads
  FROM events
  WHERE event = 'resume_upload_completed' AND timestamp > now() - INTERVAL 30 DAY
  GROUP BY person_id
)
"""

Q['C2_uploads_per_active_user_7d'] = """
SELECT
  count() AS total_completed,
  uniq(person_id) AS active_users,
  round(count() / nullIf(uniq(person_id), 0), 2) AS uploads_per_active_user
FROM events
WHERE event = 'resume_upload_completed' AND timestamp > now() - INTERVAL 7 DAY
"""

Q['C3_new_vs_returning_uploaders'] = """
SELECT
  multiIf(first_upload >= now() - INTERVAL 7 DAY, 'new', 'returning') AS cohort,
  count() AS uploaders
FROM (
  SELECT person_id, min(timestamp) AS first_upload
  FROM events
  WHERE event = 'resume_upload_completed'
  GROUP BY person_id
)
GROUP BY cohort
ORDER BY cohort
"""
