# Agent System Design Plan

## Overview

This document outlines the design plan for the memory context system used by agents in our application. The memory context system is responsible for storing, retrieving, and managing the contextual information that agents use to make decisions and perform actions.

**Note:** This system must be compatible with and support integration of Skills, MCP (Model Context Protocol), sub-agents, and other extended features.

## Core Requirements

The memory context system must satisfy the following key requirements:

### 1. Persistence

- Store agent memory states and context data in a durable storage layer
- Support multiple storage backends (e.g., memory, database, file system, cloud storage)
- Ensure data integrity and consistency across system restarts
- Implement efficient serialization/deserialization mechanisms

### 2. Traceability

- Maintain complete audit trails of all memory operations (create, read, update, delete)
- Log context modifications with timestamps and triggering events
- Track memory state evolution throughout agent lifecycles
- Support debugging and analysis through detailed operation history
- Expose external APIs for visualization and monitoring of memory traces
- Provide real-time interfaces for dynamic modification of memory context
- Support interactive debugging tools with live memory state inspection

### 3. Recoverability

- Enable restoration of agent memory states from any historical point
- Implement checkpoint mechanisms for critical memory snapshots
- Support rollback operations when errors or inconsistencies occur
- Provide graceful recovery from system failures or crashes

### 4. Scalability

- Handle increasing volumes of context data as the number of agents grows
- Optimize memory access and retrieval times for large datasets
- Support distributed memory storage and retrieval across multiple nodes
- Implement caching strategies to improve performance

## Design

The overall design uses a state machine pattern, where each Memory State is a state machine containing the current state and executable operations. States transition between each other through operations. The state machine design allows Memory State to flexibly adapt to different contextual requirements and is easy to extend and maintain.

Each Memory State consists of multiple Memory Chunks, where each Memory Chunk represents an independent piece of contextual information. Once a Memory Chunk is used, it becomes immutable; new information generates a new Memory Chunk. This design ensures the integrity and traceability of contextual information. If a Chunk is manually modified, a new Chunk is generated and the parent-child modification relationship is recorded.

Each Memory State processes operations through a Reducer, which determines the next state and the Memory Chunks to be generated based on the current state and operation type. The Reducer design enables Memory State to flexibly transition states according to different operations.

### Core Concepts

- **Agent System**: The system responsible for managing agent memory states and contextual information. It has global configurations (soft token limit, hard token limit) and management functions (e.g., registering different Storage Backends, registering different Memory Observers, LLM interfaces, etc.).
- **Memory Thread**: Has a unique id (thread_xxx). Represents an agent's memory session, containing a series of Memory States. When creating an initial Session, the initial Memory State is generated based on the Agent Blueprint configuration.
- **Memory State**: Has a unique id (state_xxx), a pure data object. Represents the agent's current memory state, containing multiple Memory Chunks and state information.
- **Memory Chunk**: Has a unique id (chunk_xxx), a pure data object. Represents an independent logical block of contextual information. It can have various types, and its actual content can also have multiple types (supports mixed text and images, and can even contain other Memory Chunks). Memory Chunk has its own priority.
- **Reducer**: Responsible for processing operations on Memory State. Ultimately generates multiple Operations to achieve modifications to Memory State.
- **Operation**: A pure data object. Represents operation types on Memory State, such as add, update, delete, reorder, replace, BatchReplace (multiple to one), etc.
- **Memory Parser**: Parses Memory State/Chunk into contextual information usable by a specific model.
- **Memory Observer**: A component that allows external systems to monitor Memory State changes and perform certain interventions.
- **Storage Backend**: The storage backend responsible for persisting Memory State and Memory Chunks, which can be in-memory, database, file system, etc.

### Memory Compact / Memory Selection Design

#### Chunk Retention Strategy

- CRITICAL - Must be retained, cannot be compressed

- COMPRESSIBLE - Can be compressed independently

- BATCH_COMPRESSIBLE - Can be compressed as a whole

- DISPOSABLE - Can be discarded when needed

- EPHEMERAL - Should be immediately discarded after the current session ends

- OTHERS - Built-in compression logic

#### Whether Chunk Can Be Modified by Agent in Current Thread

#### Chunk Types

- **System Chunk**: Contextual information related to the entire agent system, such as configuration, state, etc., generally CRITICAL type, cannot be modified.

- **Agent Chunk**: Contextual information related to the agent itself, such as identity, role, goals, etc., generally CRITICAL type, cannot be modified.

- **Workflow Chunk**: Contextual information related to agent workflows, such as task lists, progress, etc., generally CRITICAL type, cannot be modified.

- **Delegation Chunk**: Contextual information related to agent delegation, current task state, core objectives, etc., generally high-priority COMPRESSIBLE type, can be modified.

- **Environment Chunk**: Contextual information related to the current company and communication partners (company's main business, current projects, supervisor preferences), generally high-priority COMPRESSIBLE type, cannot be modified.

- **Working Flow Chunk**: Contextual information related to the agent's current workflow, such as current steps, temporary data, etc., generally low-priority COMPRESSIBLE type, can be modified. Has the following subtypes internally, with internal blocks defaulting to BATCH_COMPRESSIBLE type:
  - **Compacted Chunk**: Summarized previously compressed contextual information

  - **User Chunk**: User interjections, interventions, and reply guidance to the model.

  - **Thinking Chunk**: Contextual information related to the agent's thinking process, such as intermediate reasoning, hypotheses, etc., generally BATCH_COMPRESSIBLE type, can be modified.
  - **Response Chunk**: Intermediate process responses from the agent model

  - **Agent Action/Action Response**: Actions and responses from the Agent calling MCP, Skill, SubAgent, etc. If it's a SubAgent call, the Action Response is the sub-agent's Output Chunk.

- **Output Chunk**: The final output result of the agent, generally marking task termination.
