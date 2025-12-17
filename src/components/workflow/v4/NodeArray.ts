import Nodes from "./Nodes";
import Edges from "./Edges";
import {
  HumanIcon,
  AutomatedIcon,
  ApiIcon,
  CheckBoxIcon,
  WarningIcon,
  ErrorIcon,
  EditIcon,
  TrueCheck,
  FalseCross,
} from "./StakIcons";
import moment from "moment";
import { WorkflowTransition } from "@/types/stakwork/workflow";

interface Position {
  x: number;
  y: number;
}

interface ConnectionEdge {
  source: string;
  target: string;
  name?: string;
  target_id?: string;
}

interface JobDetails {
  completed_jobs?: { value: number };
  total_jobs?: { value: number };
  marked_correct?: { value: number };
  pending_jobs?: { value: number };
  account_nicknames?: { value: string[] };
  total_projects?: { value: number };
  completed_projects?: { value: number };
  completion_time?: { value: number | null };
  start_time?: { value: string | null };
  parsed_completion_time?: string;
}

class NodeArray {
  nodes: any[] = [];
  edges: any[] = [];
  connecting_edges: ConnectionEdge[];
  connected_to_end: string[];
  show_only: boolean | string;
  mode: string;
  projectId?: string;
  isAdmin: boolean;
  isProject: boolean;
  workflowId: string;
  workflowVersion: string;
  currentCompletedStepPos?: Position;
  finishedNodePos?: Position;
  workflow_state?: string;

  constructor(
    transitions: Record<string, WorkflowTransition>,
    connecting_edges: ConnectionEdge[],
    show_only: boolean | string,
    mode: string,
    projectId: string | undefined,
    isAdmin: boolean = false,
    workflowId: string,
    workflowVersion: string,
  ) {
    this.connecting_edges = connecting_edges;
    this.connected_to_end = this.findDirectlyConnectedNodes(connecting_edges, "system.succeed");

    console.log("connected_to_end", this.connected_to_end);

    this.show_only = show_only;
    this.mode = mode;
    this.projectId = projectId;
    this.isAdmin = isAdmin;
    this.isProject = this.isProjectMode();
    this.workflowId = workflowId;
    this.workflowVersion = workflowVersion;

    this.initNodes(transitions);
    this.initEdges(this.nodes);

    if (this.isProject) {
      this.checkProjectCompletion(this.edges);
    }

    window.onload = () => {
      this.setTimer();
    };
  }

  findDirectlyConnectedNodes(edges: ConnectionEdge[], targetNode: string): string[] {
    if (!edges || edges.length === 0) {
      return [];
    }

    const directConnections = edges.filter((edge) => edge.target === targetNode);
    return directConnections.map((edge) => edge.source);
  }

  setTimer(): void {
    const timeElements = document.querySelectorAll(".step-time[data-start-time]");

    if (timeElements.length === 0) {
      return;
    }

    timeElements.forEach((element) => {
      const htmlElement = element as HTMLElement;
      const startTime = htmlElement.dataset.startTime;
      if (!startTime) return;

      setInterval(() => {
        const date = new Date(startTime);
        const now = new Date();
        const diff = now.getTime() - date.getTime();
        const hours = Math.floor(diff / 1000 / 60 / 60);
        const minutes = Math.floor((diff / 1000 / 60) % 60);
        const seconds = Math.floor((diff / 1000) % 60);
        htmlElement.innerHTML = `${hours}:${minutes < 10 ? "0" : ""}${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
      }, 1000);
    });
  }

  checkProjectCompletion(edges: any[]): void {
    edges.forEach((edge) => {
      const targetNode = this.nodes.find((node) => node.id === edge.target);
      const sourceNode = this.nodes.find((node) => node.id === edge.source);
      if (targetNode && sourceNode) {
        if (sourceNode.id === "start" && (targetNode.status === "finished" || targetNode.status === "in_progress")) {
          edge.edgeColor = "#67C083";
        } else if (!sourceNode.status) {
          //Nothing to do here
        } else if (sourceNode.status === "skipped" || targetNode.status === "skipped") {
          edge.edgeColor = "#8F979D";
          edge.animate = false;
        } else if (
          (sourceNode.status === "finished" && targetNode.id === "system.succeed") ||
          (sourceNode.status === "finished" && targetNode.id === "system.fail")
        ) {
          edge.edgeColor = "#67C083";
          edge.animate = false;
        } else if (sourceNode.status === "finished" || targetNode.status === "finished") {
          edge.edgeColor = "#67C083";
          edge.animate = false;
        }
      }
    });
  }

  setStepPos(pos: Position): void {
    if (this.isProject) {
      this.currentCompletedStepPos = pos;
    }
  }

  getCompletedStepPos(): Position | null {
    if (this.currentCompletedStepPos) {
      return { x: this.currentCompletedStepPos.x, y: this.currentCompletedStepPos.y };
    }
    return null;
  }

  setCompletedStepPos(pos: Position): void {
    this.currentCompletedStepPos = pos;
  }

  setFinishNode(pos: Position): void {
    this.finishedNodePos = pos;
  }

  getFinishNode(): Position | undefined {
    return this.finishedNodePos;
  }

  createTrueFalseEdge(type: string, index: number | string, source: string, target: string): any {
    return this.createEdge("default", index, source, target);
  }

  setSkippedNode(node: any): void {
    node.status = "skipped";
    node.textColor = "#8F979D";
    node.bgColor = "#DFE3E5";
    node.borderColor = "#DFE3E5";
  }

  setSelectedNode(node: any): void {
    node.status = "finished";

    if (node.stepType === "True") {
      node.bgColor = "#67C083";
      node.borderColor = "#67C083";
      node.textColor = "#FFFFFF";
    } else {
      node.bgColor = "#9747FF";
      node.borderColor = "#9747FF";
      node.textColor = "#FFFFFF";
    }
  }

  setErrorNode(node: any): void {
    node.bgColor = "#F5F6F8";
    node.borderColor = "#FF5252";
  }

  setHaltedNodeStyle(): void {
    const haltNode = this.nodes.find((node) => node.id === "system.fail");
    if (haltNode) {
      haltNode.bgColor = "#FF5252";
      haltNode.borderColor = "#FF5252";
    }
  }

  setSuccessNodeStyle(node: any): void {
    node.bgColor = "#67C083";
    node.borderColor = "#67C083";
  }

  setTrueFalseEdges(node: any, i: number, type: string): void {
    const targetPosition = type === "false" ? "bottom" : "top";
    const targetNode = this.nodes.find((n) => n.id === node.targetNode);
    if (targetNode === undefined) {
      return;
    }

    if (node.status !== "skipped" && node.status !== undefined) {
      if (
        node.nextStep === node.targetNode ||
        targetNode.status === "finished" ||
        targetNode.status === "in_progress"
      ) {
        const edge = this.createTrueFalseEdge(type, i, node.id, node.targetNode);
        edge.edgeColor = "#67C083";
        targetNode.targetPosition = targetPosition;

        this.setSelectedNode(node);
        node.edges.push(edge);
      } else {
        const edge = this.createEdge("skipped", i, node.id, node.targetNode);
        targetNode.targetPosition = targetPosition;
        edge.edgeColor = "#8F979D";
        node.edges.push(edge);
      }
    } else {
      const edge = this.createTrueFalseEdge(type, i, node.id, node.targetNode);
      targetNode.targetPosition = targetPosition;
      edge.animate = true;
      node.edges.push(edge);
    }
  }

  createEdge(type: string, index: number | string, source: string, target: string): any {
    switch (type) {
      case "skipped":
        return Edges.skippedEdge(`${index}-skipped`, source, target);
      case "false":
        return Edges.trueEdge(`${source}${index}-false`, source, target);
      case "true":
        return Edges.trueEdge(`${source}${index}-true`, source, target);
      case "default":
        return Edges.defaultEdge(`${target}${index}`, source, target);
      case "falseAnimated":
        return Edges.falseAnimatedEdge(`${index}-falseAnimated`, source, target);
      case "trueAnimated":
        return Edges.trueAnimatedEdge(`${index}-trueAnimated`, source, target);
      default:
        throw new Error(`Invalid edge type: ${type}`);
    }
  }

  setIfConditionEdges(node: any, i: number): void {
    if (node.status) {
      node.bgColor = "#67C083";
      node.borderColor = "#67C083";
      node.textColor = "#FFFFFF";
    }
  }

  initEdges(nodes: any[]): void {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const nextNode = nodes[i + 1];
      if (node.id === "start") {
        const edge = this.createEdge("default", i, node.id, nodes[1].id);
        node.edges.push(edge);

        if (nextNode?.stepType === "Add") {
          nextNode.targetNode = nodes[2].id;
        }
      } else if (node.id === "system.succeed" || node.id === "system.fail") {
        // Nothing to do here
      } else if (["IfCondition", "IfElseCondition", "False", "True"].includes(node.stepType)) {
        if (["IfCondition", "IfElseCondition"].includes(node.stepType)) {
          node.connection_edges?.forEach((conn_edge: any) => {
            node.edges.push({
              id: `${node.id}-${conn_edge.name}`,
              source: node.id,
              target: conn_edge.target_id,
              data: conn_edge,
              custom_label: conn_edge.name,
              disable_edge: true,
            });
          });

          this.setIfConditionEdges(node, i);
        }
      } else if (nextNode?.stepType === "Add") {
        nextNode.targetNode = node.targetNode;
        node.targetNode = nextNode.id;
        const edge = this.createEdge("default", i, node.id, node.targetNode);
        node.edges.push(edge);
      } else if (Array.isArray(node.targetNode) && node.targetNode.length > 0) {
        node.targetNode.forEach((target: string, j: number) => {
          const edge = this.createEdge("default", `${i}-${j}`, node.id, target);
          node.edges.push(edge);
        });
      } else {
        const edge = this.createEdge("default", i, node.id, node.targetNode);
        node.edges.push(edge);
      }
    }
  }

  ensureMinDistance(nodes: any[], minDistance: number = 500): any[] {
    nodes.sort((a, b) => a.position.x - b.position.x);

    for (let i = 1; i < nodes.length; i++) {
      const prevNode = nodes[i - 1];
      const currNode = nodes[i];

      if (currNode.position.x - prevNode.position.x < minDistance) {
        currNode.position.x = prevNode.position.x + minDistance;
      }
    }

    return nodes;
  }

  initNodes(transitions: Record<string, WorkflowTransition>): void {
    this.parseTransitions(transitions);

    if (this.nodes.length === 0) return;

    const firstPosition: Position = {
      x: -this.nodes[0].position.x - 300 * 2,
      y: this.nodes[0].position.y + this.nodes[0].height / 2 - 40,
    };
    const start = Nodes.startNode("1", firstPosition);
    start.borderColor = "#67c083";

    this.nodes.splice(0, 0, start);

    const endNodes = Nodes.endNodes(String(this.nodes.length + 1), this.calcPosition());

    endNodes.forEach((node) => {
      this.addNode(node);
    });

    if (this.workflow_state === "halted") {
      this.setHaltedNodeStyle();
    } else if (this.workflow_state === "completed") {
      const node = this.nodes.find((node) => node.id === "system.succeed");
      if (node) {
        this.setSuccessNodeStyle(node);
      }
    }
  }

  addNode(node: any): void {
    if (!this.isProject) {
      node.clickCallback = (clickedNode: any) =>
        this.setStepPos({ x: clickedNode.position.x, y: clickedNode.position.y });
    }
    this.nodes.push(node);
  }

  parseTransitions(transitions: Record<string, WorkflowTransition>): void {
    for (const stepId in transitions) {
      if (transitions.hasOwnProperty(stepId)) {
        const step = transitions[stepId];

        let type = "automated";
        if (step.skill?.type) {
          type = step.skill.type;
        }

        const name = step.display_id;
        const connections = this.parseConnections(step);

        if (step.name === "IfCondition" || step.name === "IfElseCondition") {
          const ifConditionNode = Nodes.ifConditionNode({
            show_only: this.show_only,
            id: step.id,
            uniqueId: step.unique_id,
            position: step.position || this.calcPosition(),
            data: name,
            status: step.next_step ? "finished" : undefined,
            nextStep: step.next_step,
            result: this.getIfconResult(step),
            rotation: "45",
            connection_edges: step.connection_edges,
            project_id: this.projectId,
          });

          this.addNode(ifConditionNode);
        } else {
          this.nodeBuilder(step, type, connections, name);
        }
      }
    }
  }

  parseConnections(step: WorkflowTransition): string | string[] {
    let connections: string | string[];

    if (step.name === "IfCondition") {
      let statement = step.step?.attributes?.statement || "system.fail";
      let elseStatement = step.step?.attributes?.else_statement || "system.fail";

      if (statement.includes("goTo(")) {
        statement = statement.replace("goTo(", "").replace(")", "");
      }

      if (elseStatement.includes("goTo(")) {
        elseStatement = elseStatement.replace("goTo(", "").replace(")", "");
      }

      connections = [statement, elseStatement];
    } else {
      connections = Object.values(step.connections || {})[0] || "";
    }
    return connections;
  }

  getNodes(): any[] {
    return this.nodes;
  }

  getEdges(): any[] {
    return this.edges;
  }

  nodeBuilder(step: WorkflowTransition, type: string, connections: string | string[], name: string): void {
    const id = step.id;
    const status = this.getStatus(step);

    this.workflow_state ||= step.status?.workflow_state;

    let node: any;
    let resultNode: any;

    const nodePosition = step.position || this.calcPosition();

    if (type === "human") {
      const data = this.newStandardData(type, step);
      node = Nodes.standardNode(id, nodePosition, data);

      if (step.name === "Boolean" && this.isProject && step.has_output) {
        resultNode = this.addBooleanNode(node, step, connections);
        connections = resultNode.id;
      }
    } else if (type === "api") {
      const data = this.newAutomatedData(type, step);
      node = Nodes.automatedNode(id, nodePosition, data);
    } else if (type === "automated") {
      const data = this.newAutomatedData(type, step);
      node = Nodes.automatedNode(id, nodePosition, data);
    } else if (type === "loop") {
      const data = this.newLoopData(type, step);
      node = Nodes.loopNode(id, nodePosition, data);
    } else {
      node = Nodes.standardNode(id, nodePosition, { html: "  " });
    }

    if (step.position) {
      node.position = step.position;
    }

    node = this.setNodeStyle(node, status, type);

    if (status !== null) {
      node.addClass(node, `${status} ${type}`);
      node.status = status;
      node.deletable = false;
    }

    if (status === "error" || status === "halted") {
      this.setErrorNode(node);
    }

    node.targetNode = connections;

    if (status === "finished") {
      if (this.connected_to_end.includes(node.id)) {
        this.setFinishNode(node.position);
      } else {
        this.setCompletedStepPos(node.position);
      }
    }

    this.addNode(node);

    if (resultNode) {
      this.addNode(resultNode);
    }

    if (this.hasFileOutput(step)) {
      this.generateFileNodes(step, node, id, status, connections);
    }
  }

  setNodeStyle(node: any, status: string | null, type: string): any {
    if (status === "finished") {
      if (type === "api") {
        node.borderColor = "#4BCDC4";
        node.bgColor = "#BEF6F2";
      } else {
        node.bgColor = "#D3F6CF";
        node.borderColor = "#67c083";
      }
    } else if (status === "in_progress") {
      if (type === "api") {
        node.borderColor = "#4BCDC4";
        node.bgColor = "white";
      } else {
        node.bgColor = "white";
        node.borderColor = "#67c083";
      }
    }

    return node;
  }

  calcPosition(): Position {
    const lastNode = this.nodes[this.nodes.length - 1];
    if (!lastNode) {
      return { x: 0, y: 0 };
    }
    const lastNodePosition = lastNode.position;

    return { x: lastNodePosition.x + lastNode.width + 150, y: 0 };
  }

  newGenerateStepHTML({ type, step, bottomHtml }: { type: string; step: WorkflowTransition; bottomHtml?: string }): {
    html: string;
  } {
    const status = this.getStatus(step);
    const rightIcon = this.setStatusIcon(step, type);

    const stepIcon = {
      mainIcon: step?.custom_icon || step?.skill_icon || null,
    };

    const stepLog = step?.log;
    const uniqueId = step.unique_id;
    let id = step.id;
    const name = step.name;
    const jobDetails = this.getJobDetails(step);
    const parsed_completion_time = this.parseCompletionTime(jobDetails?.completion_time?.value || null);
    const startTime = jobDetails?.start_time || { value: "0:00" };
    let stepType = "";
    let time = "";
    let stepIconHtml = "";
    const displayName = step.display_name || step.name;

    if (this.isAdmin && stepLog) {
      stepIconHtml = `<span class="">${stepLog}</span>`;
    } else if (this.isProject) {
      // Project view - show step-specific icons
      if (!stepIcon || !stepIcon.mainIcon) {
        stepIconHtml = `<span class="step-icon material-icons">code</span>`;
      } else if (step?.custom_icon) {
        stepIconHtml = `<img class="step-img" src="${stepIcon.mainIcon}" alt="step icon" id="custom-icon" />`;
      } else {
        const iconSrc =
          status !== "finished" && status !== "in_progress"
            ? (stepIcon.mainIcon as any)?.default
            : (stepIcon.mainIcon as any)?.active;
        if (iconSrc) {
          stepIconHtml = `<img class="step-img" src="${iconSrc}" alt="step icon" />`;
        } else {
          stepIconHtml = `<span class="step-icon material-icons">code</span>`;
        }
      }
    } else {
      // Non-project view - show automated icon as default
      stepIconHtml = `<img class="step-img" src="${AutomatedIcon}" alt="step icon" />`;
    }

    const iconElement = `<img class="workflow-step-icon" src="${this.setIcon(type)}" alt="step icon" />`;

    if (type !== null) {
      stepType = `<span class="workflow-step-type">${type.toUpperCase()}</span>`;
    } else {
      stepType = '<span class="workflow-step-type">HUMAN</span>';
    }

    let actionButton = ``;
    let debugButton = ``;

    if (status === "finished") {
      time = `<span class="workflow-step-time">${parsed_completion_time}</span>`;
      if (step.needs_human_review) {
        actionButton = `<a href="/admin/project_folders/${step.project_step_id}/review" data-turbo-frame="modal" class="workflow-step-action-item">Review Step</a>`;
      }
    } else if (status === "in_progress") {
      if (!type || type === "human") {
        actionButton = `<div class="workflow-step-action-item" data-action="click->project-buttons#doJobs" data-project-step-id="${step.project_step_id}">Complete Jobs</div>`;
      } else if (name === "Prompt") {
        actionButton = `<a href="/admin/project_folders/${step.project_step_id}/prompt" data-turbo-frame="modal" class="workflow-step-action-item">Answer Prompt</a>`;
      }
      time = `<span class="workflow-step-time" data-start-time="${startTime.value}"></span>`;
      this.setTimer();
    } else if (this.getStatus(step) === "error") {
      // Fix/Debug buttons removed - Rails-specific features not available in Hive
      // actionButton = `<div class="workflow-step-action-item" data-action="click->project-buttons#redirectToWorkflow" data-unique-id="${uniqueId}" data-workflow-version="${this.workflowVersion}" data-workflow-id="${this.workflowId}">Fix</div>`;
      // debugButton = `<div class="workflow-step-action-item" data-action="click->project-buttons#redirectToDebugWorkflow" data-unique-id="${uniqueId}" data-workflow-version="${this.workflowVersion}" data-project-folder-id="${step.project_step_id}" data-workflow-id="${this.workflowId}">Debug</div>`;
      time = `<span class="step-time error-text">ERROR</span>`;
    } else {
      time = `<span class="workflow-step-time">0:00</span>`;
    }

    const idFull = id;
    if (id.length > 30) {
      id = id.substring(0, 30) + "...";
    }
    const displayNameFull = displayName;
    let truncatedDisplayName = displayName;
    if (displayName && displayName.length > 30) {
      truncatedDisplayName = displayName.substring(0, 30) + "...";
    }
    const sub = `<div class="workflow-name-container"><span class="workflow-step-name" title="${displayNameFull}">Skill: ${truncatedDisplayName}</span><span class="workflow-step-name" title="${idFull}">Alias: ${id}</span></div>`;
    let menu: string;
    let main: string;

    if (this.isProject) {
      menu = `<div class="workflow-step-actions-menu" data-unique-id="${uniqueId}">${actionButton}${debugButton}</div>`;
      const step_class_detail = stepLog ? "workflow-step-main-log" : "workflow-step-main";
      // Step click navigation removed - Rails-specific modal not available in Hive
      // Clicking on steps no longer attempts to link to admin routes
      main = `<div class="workflow-step-main-log-container"><div class="${step_class_detail} workflow-show-modal">${stepIconHtml}</div></div>`;
    } else if (this.mode === "edit" || this.mode === "alter") {
      let copyButton = "";
      if (this.mode === "edit") {
        copyButton = `<div class="step-action-item step-copy material-icons" data-action="click->workflow-buttons#copy"  data-unique-id="${uniqueId}" data-wizard-step="${step.wizard_step}" >content_copy</div>`;
      }
      const editButton = `<div class="step-menu-edit step-action-item" data-unique-id="${uniqueId}" data-wizard-step="${step.wizard_step}" data-show-only="${this.show_only}">${EditIcon}</div>`;

      menu = `<div class="workflow-step-actions-menu" data-unique-id="${uniqueId}">${copyButton}${editButton}</div>`;
      main = `<div class="workflow-step-main workflow-step-menu-edit workflow-show-modal" data-unique-id="${uniqueId}" data-wizard-step="${step.wizard_step}" data-show-only="${this.show_only}">${stepIconHtml}</div>`;
    } else {
      menu = `<div class="workflow-step-actions-menu"></div>`;
      main = `<div class="workflow-step-main workflow-show-modal" >${stepIconHtml}</div>`;
    }
    const top = `<div class="workflow-top">${iconElement}${stepType}${time}</div>`;
    const subHead = `<div class="workflow-sub">${sub}${menu}</div>`;

    const bottom = bottomHtml ? `<div class="workflow-step-bottom">${bottomHtml}</div>` : "";

    if (type === "automated" || type === "api") {
      return {
        html: `${rightIcon}<div class="workflow-automated-template ${type}-${status}">${top}${subHead}${main}${bottom}</div>`,
      };
    } else if (type === "loop") {
      return {
        html: `${rightIcon}<div class="workflow-standard-template ${type}-${status}">${top}${subHead}${main}${bottom}</div>`,
      };
    }
    const html = `${rightIcon}<div class="workflow-standard-template ${type}-${status}">${top}${subHead}${main}${bottom}</div>`;
    return { html };
  }

  newLoopData(type: string, step: WorkflowTransition): { html: string } {
    let total_projects: { value: number };
    let completed_projects: { value: number };

    const status = this.getStatus(step);
    const jobDetails = this.getJobDetails(step);
    const childProjectId = step.step?.attributes?.workflow_id;
    const childProjectName = step.step?.attributes?.workflow_name?.substring(0, 20) + "...";
    // Rails admin links removed - display workflow name without clickable link
    const workflowDisplay = `<span class="workflow-number">${childProjectName}</span>`;

    if (jobDetails === null) {
      total_projects = { value: 0 };
      completed_projects = { value: 0 };
    } else {
      total_projects = jobDetails.total_projects || { value: 0 };
      completed_projects = jobDetails.completed_projects || { value: 0 };
    }

    let perc = 0;

    if (status === "finished") {
      perc = 100;
    } else if (completed_projects.value === 0) {
      perc = 0;
    } else {
      perc = Math.round((completed_projects.value / total_projects.value) * 100);
    }

    let loopTotal: string;

    if (total_projects.value > 0) {
      // Display child process count without clickable link
      const childProcessCount = `<span class="workflow-number">${total_projects.value} Child Processes</span>`;
      loopTotal = `<div class="workflow-loop-total">${workflowDisplay} ${childProcessCount}</div>`;
    } else if (childProjectId && !this.isProject) {
      loopTotal = `<div class="workflow-loop-total">${workflowDisplay}</div>`;
    } else {
      loopTotal = `<div class="workflow-loop-total">${workflowDisplay} <span class="workflow-number">${total_projects.value} child processes</span></div>`;
    }

    let percent = "";

    if (status === "finished" || status === "in_progress") {
      percent = `<div class="workflow-percent workflow-active"><span class="workflow-percent-num">${perc}</span>%</div>`;
    } else if (childProjectId) {
      percent = ``;
    } else {
      percent = `<div class="workflow-percent"><span class="workflow-percent-num">${perc}</span>%</div>`;
    }
    const bottomHtml = `<div class="workflow-step-bottom workflow-loop">${loopTotal}${percent}</div>`;

    return this.newGenerateStepHTML({ type: type, step: step, bottomHtml: bottomHtml });
  }

  newStandardData(type: string, step: WorkflowTransition): { html: string } {
    const totalJobs = step.step?.params?.job_count || 0;
    let numCircles = totalJobs > 5 ? 5 : totalJobs;
    let jobTotal = totalJobs;
    const status = this.getStatus(step);
    const jobDetails = this.getJobDetails(step);

    if (numCircles < (jobDetails?.total_jobs?.value || 0) && (jobDetails?.total_jobs?.value || 0) <= 5) {
      numCircles = jobDetails?.total_jobs?.value || 0;
      jobTotal = jobDetails?.total_jobs?.value || 0;
    }

    const avatarElement: string[] = [];

    if (!jobDetails) {
      const circle = `<div class="workflow-circle"></div>`;
      for (let i = 0; i < numCircles; i++) {
        avatarElement.push(circle);
      }
    } else {
      const completedJobs = jobDetails.completed_jobs?.value || 0;
      const pending_jobs = jobDetails.pending_jobs?.value || 0;
      const avatars = jobDetails.account_nicknames?.value || [];

      for (let i = 0; i < numCircles; i++) {
        if (status === "finished") {
          if (avatars[i]) {
            avatarElement.push(
              `<div class="workflow-complete_img"><img src="${avatars[i]}" class="workflow-completed" alt="avatar"><span class="material-icons check">check</span></div>`,
            );
          } else {
            avatarElement.push(`<span class="material-icons complete_img">check</span>`);
          }
        } else if (i < completedJobs) {
          if (avatars[i]) {
            avatarElement.push(
              `<div class="workflow-complete_img"><img src="${avatars[i]}" class="workflow-completed" alt="avatar"><span class="material-icons check">check</span></div>`,
            );
          } else {
            avatarElement.push(`<span class="material-icons complete_img">check</span>`);
          }
        } else if (i >= completedJobs && i <= jobTotal - pending_jobs) {
          if (avatars[i]) {
            avatarElement.push(
              `<div class="in_progress_img in_progress"><img src="${avatars[i]}" class="workflow-in_progress_avatar" alt="avatar"></div>`,
            );
          } else {
            avatarElement.push(`<span class="material-icons in_progress_img in_progress">schedule</span>`);
          }
        } else {
          avatarElement.push(`<div class="workflow-circle"></div>`);
        }
      }
    }

    const bottomHtml = `<div class="workflow-step-bottom standard">${avatarElement.join("")}</div>`;
    return this.newGenerateStepHTML({ type: type, step: step, bottomHtml: bottomHtml });
  }

  newAutomatedData(type: string, step: WorkflowTransition): { html: string } {
    return this.newGenerateStepHTML({ type: type, step: step });
  }

  setStatusIcon(step: WorkflowTransition, type: string): string {
    const status = this.getStatus(step);

    let icon = "";
    const pendingSVG = `
      <svg class="workflow-right-icon" width="256" height="256" viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M224 128C224 181.019 181.019 224 128 224C74.9807 224 32 181.019 32 128C32 74.9807 74.9807 32 128 32C181.019 32 224 74.9807 224 128Z" fill="white"/>
        <path fill-rule="evenodd" clip-rule="evenodd" d="M205 128C205 170.526 170.526 205 128 205C85.4741 205 51 170.526 51 128C51 85.4741 85.4741 51 128 51C170.526 51 205 85.4741 205 128ZM224 128C224 181.019 181.019 224 128 224C74.9807 224 32 181.019 32 128C32 74.9807 74.9807 32 128 32C181.019 32 224 74.9807 224 128ZM135.5 89.5C135.5 83.9772 131.023 79.5 125.5 79.5C119.977 79.5 115.5 83.9772 115.5 89.5V134C115.5 137.666 117.506 141.038 120.727 142.787L161.227 164.787C166.08 167.423 172.151 165.626 174.787 160.773C177.423 155.92 175.626 149.849 170.773 147.213L135.5 128.052V89.5Z" fill="#67C083"/>
      </svg>
    `;

    if (status === "finished") {
      if (step.needs_human_review) {
        icon = WarningIcon;
      } else {
        icon = CheckBoxIcon;
      }
    } else if (status === "in_progress") {
      if (step.name === "Prompt") {
        icon = WarningIcon;
      } else {
        icon = pendingSVG;
      }
    } else if (status === "error") {
      icon = ErrorIcon;
    }

    if (icon === "") {
      return "";
    }

    let element = "";
    if (type === "api") {
      if (status === "in_progress") {
        icon = icon.replace('fill="#67C083"', 'fill="#4BCDC4"');
      }
    }

    if (status === "in_progress") {
      element = icon;
    } else {
      element = `<img class="workflow-right-icon" src="${icon}" />`;
    }

    return element;
  }

  getJobDetails(step: WorkflowTransition): JobDetails | null {
    if (!step.status) {
      return null;
    }
    const {
      completed_jobs,
      total_jobs,
      marked_correct,
      pending_jobs,
      account_nicknames,
      total_projects,
      completed_projects,
      completion_time,
      start_time,
      parsed_completion_time,
    } = step.status.job_statuses || {};
    return {
      completed_jobs,
      total_jobs,
      marked_correct,
      pending_jobs,
      account_nicknames,
      total_projects,
      completed_projects,
      completion_time,
      start_time,
      parsed_completion_time,
    };
  }

  getStatus(step: WorkflowTransition): string | null {
    if (step.status?.step_state) {
      return step.status.step_state;
    } else if (step.last_transition_state) {
      return step.last_transition_state;
    } else {
      return null;
    }
  }

  setIcon(type: string): string {
    if (type === "human") {
      return HumanIcon;
    } else if (type === "api") {
      return ApiIcon;
    } else if (type === "automated") {
      return AutomatedIcon;
    } else if (type === "loop") {
      return AutomatedIcon;
    }
    // Default to automated icon for unknown types
    return AutomatedIcon;
  }

  getOutputTemplates({ step }: { step: WorkflowTransition }): any[] | undefined {
    return step.output_templates;
  }

  hasFileOutput(step: WorkflowTransition): boolean {
    if (step.has_output && step.output_templates) {
      return true;
    }

    return false;
  }

  humanize(str: string): string {
    return str
      .replace(/^[\s_]+|[\s_]+$/g, "")
      .replace(/[_\s]+/g, " ")
      .replace(/^[a-z]/, function (m) {
        return m.toUpperCase();
      });
  }

  setPolyPreview(step: WorkflowTransition): string {
    const mediaUrl = step.output?.media_url;
    const polygons = step.output?.polygons;

    const polygonsCoordinatesArray = polygons?.map((polygon: any) => {
      const coordinates = polygon.scaled_coordinates;
      return Object.values(coordinates).map((coord: any) => {
        return { x: parseFloat(coord.x), y: parseFloat(coord.y) };
      });
    });

    const name = `<span class="poly-name">${step.id} Output</span>`;
    const data = `<div data-controller="polygon-job-new" data-polygon-job-new-target="imageContainerNode" data-action="load@window->polygon-job-new#renderImageOutput click->polygon-job-new#openModal" data-media-url="${mediaUrl}" data-polygons=${JSON.stringify(polygonsCoordinatesArray)} data-render-width="80">
            <canvas data-polygon-job-new-target="canvasImgOutput"></canvas>
          </div>`;

    return `<div class="poly-preview">${data} ${name}</div>`;
  }

  generateFileNodes(
    step: WorkflowTransition,
    node: any,
    id: string,
    status: string | null,
    connections: string | string[],
  ): void {
    if (step.name === "Polygon") {
      const data = this.setPolyPreview(step);
      const polyNode = Nodes.polyNode(`${id}-output`, this.calcPosition(), { html: data });

      polyNode.position.x = polyNode.position.x - 50;
      polyNode.borderColor = "#67c083";
      polyNode.targetNode = node.targetNode;
      node.targetNode = polyNode.id;
      this.addNode(polyNode);

      return;
    }
    const files = this.getOutputTemplates({ step: step });

    if (!files) {
      return;
    }

    let firstFile: any;

    if (files.length > 1) {
      node.targetNode = [];
    }

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      let fileNode: any;

      if (i === 0) {
        fileNode = Nodes.fileNode(`${id}-output${i}`, this.calcPosition(), { html: file });
        if (step.position) {
          fileNode.position.x = step.position.x - 20;
          fileNode.position.y = step.position.y - 130;
        } else {
          fileNode.position.x = fileNode.position.x - 50;
        }

        firstFile = fileNode;
        if (Array.isArray(node.targetNode)) {
          node.targetNode.push(fileNode.id);
        } else {
          node.targetNode = fileNode.id;
        }
      } else {
        fileNode = Nodes.fileNode(`${id}-output-${i}`, this.calcPosition(), { html: file });
        fileNode.position.y = firstFile.position.y - i * 140;
        fileNode.position.x = firstFile.position.x;
        node.targetNode.push(fileNode.id);
      }

      fileNode.targetNode = connections;

      if (status === "finished") {
        this.setCompletedStepPos(fileNode.position);
        fileNode.borderColor = "#67c083";
      }

      this.addNode(fileNode);
    }
  }

  addBooleanNode(node: any, step: WorkflowTransition, connections: string | string[]): any {
    const id = node.id;

    const position = {
      x: node.width + node.position.x + 90,
      y: node.position.y + (node.height / 2 - 50),
    };

    let output: boolean | undefined;
    let bgColor: string;
    let borderColor: string;
    let outputIcon: string;
    let data: string;
    let textColor: string | undefined;

    if (step.output) {
      output = step.output.value;
      if (output === true) {
        bgColor = "#67c083";
        borderColor = "#67c083";
        outputIcon = `<img src="${TrueCheck}" alt="yes icon" class="workflow-bool-output-icon">`;
        data = `<div class="workflow-bool-output">${outputIcon}<span class="workflow-bool-text">Yes</span></div>`;
      } else {
        bgColor = "#9747FF";
        borderColor = "#9747FF";
        outputIcon = `<img src="${FalseCross}" alt="no icon" class="workflow-bool-output-icon">`;
        data = `<div class="workflow-bool-output">${outputIcon}<span class="workflow-bool-text">No</span></div>`;
      }
    } else {
      return;
    }

    const booleanNode = Nodes.booleanResultNode({
      id: `${id}-output`,
      position: position,
      data: {
        html: data,
      },
      result: output !== undefined ? String(output) : undefined,
      bgColor: bgColor,
      className: `bool-node-${output}`,
      status: step.status?.step_state,
    });

    if (textColor) {
      booleanNode.textColor = textColor;
    }
    booleanNode.borderColor = borderColor;
    booleanNode.targetNode = connections;
    node.childNodes = [booleanNode.id];
    booleanNode.position.x = node.position.x + node.width - 20;
    return booleanNode;
  }

  parseCompletionTime(completionTime: number | null): string {
    if (completionTime === null) {
      return "0:00";
    }

    const duration = moment.duration(completionTime, "seconds");
    const days = duration.days();
    const hours = duration.hours();
    const minutes = duration.minutes();
    const seconds = duration.seconds();
    const milliseconds = duration.milliseconds();

    let timeString = "";
    if (days > 0) {
      timeString += `${days}d `;
    }
    if (hours > 0) {
      timeString += `${hours}h `;
    }
    if (minutes > 0) {
      timeString += `${minutes}m `;
    }
    if (seconds > 0) {
      timeString += `${seconds}s`;
    }
    if (milliseconds > 0 && timeString === "") {
      timeString += `${parseInt(String(milliseconds))}ms`;
    }

    if (timeString === "") {
      return "0:00";
    } else {
      return timeString;
    }
  }

  shiftPosition(i: number, nodes: any[]): void {
    for (let j = i + 2; j < nodes.length; j++) {
      nodes[j].position = { x: nodes[j].position.x + 200, y: nodes[j].position.y };
    }
  }

  getIfconResult(step: WorkflowTransition): string | undefined {
    if (!step.has_output) {
      return undefined;
    }
    return step.output?.result || undefined;
  }

  isProjectMode(): boolean {
    return this.mode === "project";
  }
}

export default NodeArray;
