/** Fixed-shape counters for the manual one-shot smoke path. Never includes email content or IDs. */
export interface SmokeStructureDiagnostics {
  selected_id_matches_candidate_1: boolean;
  html_parts_before_decode: number;
  plain_parts_before_decode: number;
  html_parts_after_decode: number;
  plain_parts_after_decode: number;
  html_parts_skipped_filename: number;
  html_parts_skipped_content_disposition: number;
  html_tables_before_hidden_filter: number;
  html_tables_after_hidden_filter: number;
  html_tables_preserved_legacy_css_comment: number;
  html_tables_preserved_legacy_css_escape: number;
  html_tables_preserved_legacy_css_substring: number;
  tables_header_gate_passed: number;
  header_reject_cell_count: number;
  header_reject_nested_table: number;
  header_reject_span: number;
  header_reject_header_mismatch: number;
  extracted_projects: number;
}

export function createSmokeStructureDiagnostics(selectedIdMatchesCandidate1: boolean): SmokeStructureDiagnostics {
  return {
    selected_id_matches_candidate_1: selectedIdMatchesCandidate1,
    html_parts_before_decode: 0,
    plain_parts_before_decode: 0,
    html_parts_after_decode: 0,
    plain_parts_after_decode: 0,
    html_parts_skipped_filename: 0,
    html_parts_skipped_content_disposition: 0,
    html_tables_before_hidden_filter: 0,
    html_tables_after_hidden_filter: 0,
    html_tables_preserved_legacy_css_comment: 0,
    html_tables_preserved_legacy_css_escape: 0,
    html_tables_preserved_legacy_css_substring: 0,
    tables_header_gate_passed: 0,
    header_reject_cell_count: 0,
    header_reject_nested_table: 0,
    header_reject_span: 0,
    header_reject_header_mismatch: 0,
    extracted_projects: 0,
  };
}

export function printSmokeStructureDiagnostics(value: SmokeStructureDiagnostics): void {
  console.info(JSON.stringify(value));
}
