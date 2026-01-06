export { StateNode, type StateNodeData, type StateNodeType } from "./StateNode";
export {
  SubAgentNode,
  type SubAgentNodeData,
  type SubAgentNodeType,
} from "./SubAgentNode";

import type { NodeTypes } from "@xyflow/react";
import { StateNode } from "./StateNode";
import { SubAgentNode } from "./SubAgentNode";

/**
 * Node types registry for React Flow
 */
export const nodeTypes: NodeTypes = {
  stateNode: StateNode,
  subAgentNode: SubAgentNode,
};
