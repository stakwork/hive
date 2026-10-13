/**
 * The 52 tools Jamie's concept mode shows on a user turn, written out from
 * the spec (not derived from the code under test): 6 graph read, 8 canvas &
 * roadmap, 3 planner, 2 whiteboard, 3 workspace, 5 jobs & strut, 3 concepts,
 * 2 web, 3 HTML, 5 research, 4 prompts, 7 graph write, 1 deferred check.
 * `stay_silent` joins on wake turns (53).
 */
export const CONCEPT_MODE_TOOL_NAMES_52: readonly string[] = [
  // Graph read (6)
  "graph_get",
  "graph_neighbors",
  "graph_search",
  "graph_query",
  "graph_ontology",
  "get_ontology_type",
  // Canvas and roadmap (8)
  "read_canvas",
  "read_initiative",
  "read_milestone",
  "propose_initiative",
  "propose_feature",
  "propose_milestone",
  "assign_feature_to_initiative",
  "assign_feature_to_workspace",
  // Feature planner (3)
  "send_to_feature_planner",
  "cancel_feature_planner",
  "read_user_activity",
  // Whiteboard (2)
  "update_canvas",
  "patch_canvas",
  // Workspace tools (3)
  "repo_agent",
  "logs_agent",
  "search_logs",
  // Jobs and strut (5)
  "dispatch_strut",
  "check_strut_chat",
  "list_strut_chats",
  "start_job",
  "continue_job",
  // Concepts (3)
  "read_concept_documentation",
  "propose_new_concept",
  "propose_concept_update",
  // Web (2)
  "web_search",
  "web_fetch",
  // HTML pages (3)
  "save_html",
  "update_html",
  "get_html",
  // Research (5)
  "dispatch_research",
  "save_research",
  "update_research",
  "list_research",
  "read_research",
  // Prompts (4)
  "get_prompt",
  "list_prompts",
  "propose_new_prompt",
  "propose_prompt_update",
  // Graph write (7)
  "propose_create_node",
  "propose_node_edit",
  "propose_create_triplet",
  "propose_create_batch_triplet",
  "propose_delete_edge",
  "propose_move_node",
  "propose_delete_node",
  // Deferred checks (1)
  "schedule_check",
];
