import {
  Position,
  getConnectedEdges,
  getIncomers,
  getOutgoers,
} from 'reactflow'
import dagre from '@dagrejs/dagre'
import { v4 as uuid4 } from 'uuid'
import {
  cloneDeep,
  groupBy,
  isEqual,
  uniqBy,
} from 'lodash-es'
import type {
  Edge,
  InputVar,
  Node,
  ToolWithProvider,
  ValueSelector,
} from './types'
import {
  BlockEnum,
  ErrorHandleMode,
  NodeRunningStatus,
} from './types'
import {
  CUSTOM_NODE,
  DEFAULT_RETRY_INTERVAL,
  DEFAULT_RETRY_MAX,
  ITERATION_CHILDREN_Z_INDEX,
  ITERATION_NODE_Z_INDEX,
  NODE_WIDTH_X_OFFSET,
  START_INITIAL_POSITION,
} from './constants'
import { CUSTOM_ITERATION_START_NODE } from './nodes/iteration-start/constants'
import type { QuestionClassifierNodeType } from './nodes/question-classifier/types'
import type { IfElseNodeType } from './nodes/if-else/types'
import { branchNameCorrect } from './nodes/if-else/utils'
import type { ToolNodeType } from './nodes/tool/types'
import type { IterationNodeType } from './nodes/iteration/types'
import { CollectionType } from '@/app/components/tools/types'
import { toolParametersToFormSchemas } from '@/app/components/tools/utils/to-form-schema'

const WHITE = 'WHITE'
const GRAY = 'GRAY'
const BLACK = 'BLACK'

const isCyclicUtil = (nodeId: string, color: Record<string, string>, adjList: Record<string, string[]>, stack: string[]) => {
  color[nodeId] = GRAY
  stack.push(nodeId)

  for (let i = 0; i < adjList[nodeId].length; ++i) {
    const childId = adjList[nodeId][i]

    if (color[childId] === GRAY) {
      stack.push(childId)
      return true
    }
    if (color[childId] === WHITE && isCyclicUtil(childId, color, adjList, stack))
      return true
  }
  color[nodeId] = BLACK
  if (stack.length > 0 && stack[stack.length - 1] === nodeId)
    stack.pop()
  return false
}

const getCycleEdges = (nodes: Node[], edges: Edge[]) => {
  const adjList: Record<string, string[]> = {}
  const color: Record<string, string> = {}
  const stack: string[] = []

  for (const node of nodes) {
    color[node.id] = WHITE
    adjList[node.id] = []
  }

  for (const edge of edges)
    adjList[edge.source]?.push(edge.target)

  for (let i = 0; i < nodes.length; i++) {
    if (color[nodes[i].id] === WHITE)
      isCyclicUtil(nodes[i].id, color, adjList, stack)
  }

  const cycleEdges = []
  if (stack.length > 0) {
    const cycleNodes = new Set(stack)
    for (const edge of edges) {
      if (cycleNodes.has(edge.source) && cycleNodes.has(edge.target))
        cycleEdges.push(edge)
    }
  }

  return cycleEdges
}

/**
 * 生成并获取迭代节点的开始节点
 * @param iterationId
 * @returns
 */
export function getIterationStartNode(iterationId: string): Node {
  return generateNewNode({
    id: `${iterationId}start`,
    type: CUSTOM_ITERATION_START_NODE,
    data: {
      title: '',
      desc: '',
      type: BlockEnum.IterationStart,
      isInIteration: true,
    },
    position: {
      x: 24,
      y: 68,
    },
    zIndex: ITERATION_CHILDREN_Z_INDEX,
    parentId: iterationId,
    selectable: false,
    draggable: false,
  }).newNode
}

/**
 * 生成一个新节点
 * @param param0
 * @returns
 */
export function generateNewNode({ data, position, id, zIndex, type, ...rest }: Omit<Node, 'id'> & { id?: string }): {
  newNode: Node
  newIterationStartNode?: Node
} {
  const newNode = {
    id: id || `${Date.now()}`,
    type: type || CUSTOM_NODE,
    data,
    position,
    targetPosition: Position.Left,
    sourcePosition: Position.Right,
    zIndex: data.type === BlockEnum.Iteration ? ITERATION_NODE_Z_INDEX : zIndex,
    ...rest,
  } as Node

  if (data.type === BlockEnum.Iteration) {
    const newIterationStartNode = getIterationStartNode(newNode.id);
    (newNode.data as IterationNodeType).start_node_id = newIterationStartNode.id;
    (newNode.data as IterationNodeType)._children = [newIterationStartNode.id]
    return {
      newNode,
      newIterationStartNode,
    }
  }

  return {
    newNode,
  }
}

/**
 * 预处理节点和边
 * 主要针对存在迭代节点的情况，如果不存在迭代节点则直接返回
 * @param nodes
 * @param edges
 * @returns
 */
export const preprocessNodesAndEdges = (nodes: Node[], edges: Edge[]) => {
  const hasIterationNode = nodes.some(node => node.data.type === BlockEnum.Iteration)

  if (!hasIterationNode) {
    return {
      nodes,
      edges,
    }
  }
  const nodesMap = nodes.reduce((prev, next) => {
    prev[next.id] = next
    return prev
  }, {} as Record<string, Node>)
  const iterationNodesWithStartNode = [] // 迭代节点中有开始节点的
  const iterationNodesWithoutStartNode = [] // 迭代节点中没有开始节点的

  for (let i = 0; i < nodes.length; i++) {
    const currentNode = nodes[i] as Node<IterationNodeType>

    if (currentNode.data.type === BlockEnum.Iteration) {
      if (currentNode.data.start_node_id) {
        // 获得迭代节点中的所有节点，包括开始节点
        if (nodesMap[currentNode.data.start_node_id]?.type !== CUSTOM_ITERATION_START_NODE)
          iterationNodesWithStartNode.push(currentNode)
      }
      else {
        // 获得迭代节点中的所有节点，不包括开始节点
        iterationNodesWithoutStartNode.push(currentNode)
      }
    }
  }
  const newIterationStartNodesMap = {} as Record<string, Node>
  const newIterationStartNodes = [...iterationNodesWithStartNode, ...iterationNodesWithoutStartNode].map((iterationNode, index) => {
    const newNode = getIterationStartNode(iterationNode.id)
    newNode.id = newNode.id + index
    newIterationStartNodesMap[iterationNode.id] = newNode
    return newNode
  })
  // 创建一条新边，将迭代节点的开始节点将新生成的节点连接，并且将新生成的节点视为开始节点
  const newEdges = iterationNodesWithStartNode.map((iterationNode) => {
    const newNode = newIterationStartNodesMap[iterationNode.id]
    const startNode = nodesMap[iterationNode.data.start_node_id]
    const source = newNode.id
    const sourceHandle = 'source'
    const target = startNode.id
    const targetHandle = 'target'
    return {
      id: `${source}-${sourceHandle}-${target}-${targetHandle}`,
      type: 'custom',
      source,
      sourceHandle,
      target,
      targetHandle,
      data: {
        sourceType: newNode.data.type,
        targetType: startNode.data.type,
        isInIteration: true,
        iteration_id: startNode.parentId,
        _connectedNodeIsSelected: true,
      },
      zIndex: ITERATION_CHILDREN_Z_INDEX,
    }
  })
  // 遍历并且重新复制迭代节点的start_node_id
  nodes.forEach((node) => {
    if (node.data.type === BlockEnum.Iteration && newIterationStartNodesMap[node.id])
      (node.data as IterationNodeType).start_node_id = newIterationStartNodesMap[node.id].id
  })

  return {
    nodes: [...nodes, ...newIterationStartNodes],
    edges: [...edges, ...newEdges],
  }
}

export const initialNodes = (originNodes: Node[], originEdges: Edge[]) => {
  const { nodes, edges } = preprocessNodesAndEdges(cloneDeep(originNodes), cloneDeep(originEdges))
  const firstNode = nodes[0]

  if (!firstNode?.position) {
    nodes.forEach((node, index) => {
      node.position = {
        x: START_INITIAL_POSITION.x + index * NODE_WIDTH_X_OFFSET,
        y: START_INITIAL_POSITION.y,
      }
    })
  }

  const iterationNodeMap = nodes.reduce((acc, node) => {
    if (node.parentId) {
      if (acc[node.parentId])
        acc[node.parentId].push(node.id)
      else
        acc[node.parentId] = [node.id]
    }
    return acc
  }, {} as Record<string, string[]>)

  return nodes.map((node) => {
    if (!node.type)
      node.type = CUSTOM_NODE

    const connectedEdges = getConnectedEdges([node], edges)
    node.data._connectedSourceHandleIds = connectedEdges.filter(edge => edge.source === node.id).map(edge => edge.sourceHandle || 'source')
    node.data._connectedTargetHandleIds = connectedEdges.filter(edge => edge.target === node.id).map(edge => edge.targetHandle || 'target')

    if (node.data.type === BlockEnum.IfElse) {
      const nodeData = node.data as IfElseNodeType

      if (!nodeData.cases && nodeData.logical_operator && nodeData.conditions) {
        (node.data as IfElseNodeType).cases = [
          {
            case_id: 'true',
            logical_operator: nodeData.logical_operator,
            conditions: nodeData.conditions,
          },
        ]
      }
      node.data._targetBranches = branchNameCorrect([
        ...(node.data as IfElseNodeType).cases.map(item => ({ id: item.case_id, name: '' })),
        { id: 'false', name: '' },
      ])
    }

    if (node.data.type === BlockEnum.QuestionClassifier) {
      node.data._targetBranches = (node.data as QuestionClassifierNodeType).classes.map((topic) => {
        return topic
      })
    }

    if (node.data.type === BlockEnum.Iteration) {
      const iterationNodeData = node.data as IterationNodeType
      iterationNodeData._children = iterationNodeMap[node.id] || []
      iterationNodeData.is_parallel = iterationNodeData.is_parallel || false
      iterationNodeData.parallel_nums = iterationNodeData.parallel_nums || 10
      iterationNodeData.error_handle_mode = iterationNodeData.error_handle_mode || ErrorHandleMode.Terminated
    }

    if (node.data.type === BlockEnum.HttpRequest && !node.data.retry_config) {
      node.data.retry_config = {
        retry_enabled: true,
        max_retries: DEFAULT_RETRY_MAX,
        retry_interval: DEFAULT_RETRY_INTERVAL,
      }
    }

    return node
  })
}

export const initialEdges = (originEdges: Edge[], originNodes: Node[]) => {
  const { nodes, edges } = preprocessNodesAndEdges(cloneDeep(originNodes), cloneDeep(originEdges))
  let selectedNode: Node | null = null
  const nodesMap = nodes.reduce((acc, node) => {
    acc[node.id] = node

    if (node.data?.selected)
      selectedNode = node

    return acc
  }, {} as Record<string, Node>)

  const cycleEdges = getCycleEdges(nodes, edges)
  return edges.filter((edge) => {
    return !cycleEdges.find(cycEdge => cycEdge.source === edge.source && cycEdge.target === edge.target)
  }).map((edge) => {
    edge.type = 'custom'

    if (!edge.sourceHandle)
      edge.sourceHandle = 'source'

    if (!edge.targetHandle)
      edge.targetHandle = 'target'

    if (!edge.data?.sourceType && edge.source && nodesMap[edge.source]) {
      edge.data = {
        ...edge.data,
        sourceType: nodesMap[edge.source].data.type!,
      } as any
    }

    if (!edge.data?.targetType && edge.target && nodesMap[edge.target]) {
      edge.data = {
        ...edge.data,
        targetType: nodesMap[edge.target].data.type!,
      } as any
    }

    if (selectedNode) {
      edge.data = {
        ...edge.data,
        _connectedNodeIsSelected: edge.source === selectedNode.id || edge.target === selectedNode.id,
      } as any
    }

    return edge
  })
}

/**
 * 利用dagre布局算法获取flow布局
 * @param originNodes
 * @param originEdges
 * @returns
 */
export const getLayoutByDagre = (originNodes: Node[], originEdges: Edge[]) => {
  const dagreGraph = new dagre.graphlib.Graph()
  dagreGraph.setDefaultEdgeLabel(() => ({}))
  const nodes = cloneDeep(originNodes).filter(node => !node.parentId && node.type === CUSTOM_NODE)
  const edges = cloneDeep(originEdges).filter(edge => !edge.data?.isInIteration)
  dagreGraph.setGraph({
    rankdir: 'LR',
    align: 'UL',
    nodesep: 40,
    ranksep: 60,
    ranker: 'tight-tree',
    marginx: 30,
    marginy: 200,
  })
  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, {
      width: node.width!,
      height: node.height!,
    })
  })

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target)
  })

  dagre.layout(dagreGraph)

  return dagreGraph
}

/**
 * 能够单独运行的节点
 * @param nodeType
 * @returns
 */
export const canRunBySingle = (nodeType: BlockEnum) => {
  return nodeType === BlockEnum.LLM
    || nodeType === BlockEnum.KnowledgeRetrieval
    || nodeType === BlockEnum.Code
    || nodeType === BlockEnum.TemplateTransform
    || nodeType === BlockEnum.QuestionClassifier
    || nodeType === BlockEnum.HttpRequest
    || nodeType === BlockEnum.Tool
    || nodeType === BlockEnum.ParameterExtractor
    || nodeType === BlockEnum.Iteration
}

type ConnectedSourceOrTargetNodesChange = {
  type: string
  edge: Edge
}[]
/**
 * 获取节点连接的源节点或目标节点的ID集合
 * @param changes
 * @param nodes
 * @returns
 */
export const getNodesConnectedSourceOrTargetHandleIdsMap = (changes: ConnectedSourceOrTargetNodesChange, nodes: Node[]) => {
  const nodesConnectedSourceOrTargetHandleIdsMap = {} as Record<string, any>

  changes.forEach((change) => {
    const {
      edge,
      type,
    } = change
    const sourceNode = nodes.find(node => node.id === edge.source)!
    if (sourceNode) {
      nodesConnectedSourceOrTargetHandleIdsMap[sourceNode.id] = nodesConnectedSourceOrTargetHandleIdsMap[sourceNode.id] || {
        _connectedSourceHandleIds: [...(sourceNode?.data._connectedSourceHandleIds || [])],
        _connectedTargetHandleIds: [...(sourceNode?.data._connectedTargetHandleIds || [])],
      }
    }

    const targetNode = nodes.find(node => node.id === edge.target)!
    if (targetNode) {
      nodesConnectedSourceOrTargetHandleIdsMap[targetNode.id] = nodesConnectedSourceOrTargetHandleIdsMap[targetNode.id] || {
        _connectedSourceHandleIds: [...(targetNode?.data._connectedSourceHandleIds || [])],
        _connectedTargetHandleIds: [...(targetNode?.data._connectedTargetHandleIds || [])],
      }
    }

    if (sourceNode) {
      if (type === 'remove') {
        const index = nodesConnectedSourceOrTargetHandleIdsMap[sourceNode.id]._connectedSourceHandleIds.findIndex((handleId: string) => handleId === edge.sourceHandle)
        nodesConnectedSourceOrTargetHandleIdsMap[sourceNode.id]._connectedSourceHandleIds.splice(index, 1)
      }

      if (type === 'add')
        nodesConnectedSourceOrTargetHandleIdsMap[sourceNode.id]._connectedSourceHandleIds.push(edge.sourceHandle || 'source')
    }

    if (targetNode) {
      if (type === 'remove') {
        const index = nodesConnectedSourceOrTargetHandleIdsMap[targetNode.id]._connectedTargetHandleIds.findIndex((handleId: string) => handleId === edge.targetHandle)
        nodesConnectedSourceOrTargetHandleIdsMap[targetNode.id]._connectedTargetHandleIds.splice(index, 1)
      }

      if (type === 'add')
        nodesConnectedSourceOrTargetHandleIdsMap[targetNode.id]._connectedTargetHandleIds.push(edge.targetHandle || 'target')
    }
  })

  return nodesConnectedSourceOrTargetHandleIdsMap
}

export const genNewNodeTitleFromOld = (oldTitle: string) => {
  const regex = /^(.+?)\s*\((\d+)\)\s*$/
  const match = oldTitle.match(regex)

  if (match) {
    const title = match[1]
    const num = parseInt(match[2], 10)
    return `${title} (${num + 1})`
  }
  else {
    return `${oldTitle} (1)`
  }
}

/**
 * 获取工作流所有的节点和每个分支节点深度
 * @param nodes
 * @param edges
 * @returns
 */
export const getValidTreeNodes = (nodes: Node[], edges: Edge[]) => {
  const startNode = nodes.find(node => node.data.type === BlockEnum.Start)

  if (!startNode) {
    return {
      validNodes: [],
      maxDepth: 0,
    }
  }

  const list: Node[] = [startNode]
  let maxDepth = 1

  const traverse = (root: Node, depth: number) => {
    if (depth > maxDepth)
      maxDepth = depth

    const outgoers = getOutgoers(root, nodes, edges)

    if (outgoers.length) {
      outgoers.forEach((outgoer) => {
        list.push(outgoer)
        if (outgoer.data.type === BlockEnum.Iteration)
          list.push(...nodes.filter(node => node.parentId === outgoer.id))
        traverse(outgoer, depth + 1)
      })
    }
    else {
      list.push(root)
      if (root.data.type === BlockEnum.Iteration)
        list.push(...nodes.filter(node => node.parentId === root.id))
    }
  }

  traverse(startNode, maxDepth)

  return {
    validNodes: uniqBy(list, 'id'),
    maxDepth,
  }
}

export const getToolCheckParams = (
  toolData: ToolNodeType,
  buildInTools: ToolWithProvider[],
  customTools: ToolWithProvider[],
  workflowTools: ToolWithProvider[],
  language: string,
) => {
  const { provider_id, provider_type, tool_name } = toolData
  const isBuiltIn = provider_type === CollectionType.builtIn
  const currentTools = provider_type === CollectionType.builtIn ? buildInTools : provider_type === CollectionType.custom ? customTools : workflowTools
  const currCollection = currentTools.find(item => item.id === provider_id)
  const currTool = currCollection?.tools.find(tool => tool.name === tool_name)
  const formSchemas = currTool ? toolParametersToFormSchemas(currTool.parameters) : []
  const toolInputVarSchema = formSchemas.filter((item: any) => item.form === 'llm')
  const toolSettingSchema = formSchemas.filter((item: any) => item.form !== 'llm')

  return {
    // 输入Schema
    toolInputsSchema: (() => {
      const formInputs: InputVar[] = []
      toolInputVarSchema.forEach((item: any) => {
        formInputs.push({
          label: item.label[language] || item.label.en_US,
          variable: item.variable,
          type: item.type,
          required: item.required,
        })
      })
      return formInputs
    })(),
    // 是否有权限
    notAuthed: isBuiltIn && !!currCollection?.allow_delete && !currCollection?.is_team_authorization,
    toolSettingSchema,
    language,
  }
}

export const changeNodesAndEdgesId = (nodes: Node[], edges: Edge[]) => {
  const idMap = nodes.reduce((acc, node) => {
    acc[node.id] = uuid4()

    return acc
  }, {} as Record<string, string>)

  const newNodes = nodes.map((node) => {
    return {
      ...node,
      id: idMap[node.id],
    }
  })

  const newEdges = edges.map((edge) => {
    return {
      ...edge,
      source: idMap[edge.source],
      target: idMap[edge.target],
    }
  })

  return [newNodes, newEdges] as [Node[], Edge[]]
}

export const isMac = () => {
  return navigator.userAgent.toUpperCase().includes('MAC')
}

const specialKeysNameMap: Record<string, string | undefined> = {
  ctrl: '⌘',
  alt: '⌥',
  shift: '⇧',
}

export const getKeyboardKeyNameBySystem = (key: string) => {
  if (isMac())
    return specialKeysNameMap[key] || key

  return key
}

const specialKeysCodeMap: Record<string, string | undefined> = {
  ctrl: 'meta',
}

export const getKeyboardKeyCodeBySystem = (key: string) => {
  if (isMac())
    return specialKeysCodeMap[key] || key

  return key
}

export const getTopLeftNodePosition = (nodes: Node[]) => {
  let minX = Infinity
  let minY = Infinity

  nodes.forEach((node) => {
    if (node.position.x < minX)
      minX = node.position.x

    if (node.position.y < minY)
      minY = node.position.y
  })

  return {
    x: minX,
    y: minY,
  }
}

export const isEventTargetInputArea = (target: HTMLElement) => {
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
    return true

  if (target.contentEditable === 'true')
    return true
}

export const variableTransformer = (v: ValueSelector | string) => {
  if (typeof v === 'string')
    return v.replace(/^{{#|#}}$/g, '').split('.')

  return `{{#${v.join('.')}#}}`
}

type ParallelInfoItem = {
  parallelNodeId: string
  depth: number
  isBranch?: boolean
}
type NodeParallelInfo = {
  parallelNodeId: string
  edgeHandleId: string
  depth: number
}
type NodeHandle = {
  node: Node
  handle: string
}
type NodeStreamInfo = {
  upstreamNodes: Set<string>
  downstreamEdges: Set<string>
}

/**
 * 获取工作流并行信息，包括连接边是否正常、并行深度、并行嵌套等信息
 * @param nodes
 * @param edges
 * @param parentNodeId
 * @returns
 */
export const getParallelInfo = (nodes: Node[], edges: Edge[], parentNodeId?: string) => {
  let startNode

  if (parentNodeId) {
    const parentNode = nodes.find(node => node.id === parentNodeId)
    if (!parentNode)
      throw new Error('Parent node not found')

    startNode = nodes.find(node => node.id === (parentNode.data as IterationNodeType).start_node_id)
  }
  else {
    startNode = nodes.find(node => node.data.type === BlockEnum.Start)
  }
  if (!startNode)
    throw new Error('Start node not found')

  const parallelList = [] as ParallelInfoItem[]
  const nextNodeHandles = [{ node: startNode, handle: 'source' }]
  let hasAbnormalEdges = false // 是否有异常边

  const traverse = (firstNodeHandle: NodeHandle) => {
    /**
     * 利用Set记录从开始节点到当前节点的所有边（key: 节点ID，value: 路径ID（1735031820954(开始)-source-1735297167226(LLM7)-target））
     */
    const nodeEdgesSet = {} as Record<string, Set<string>>
    const totalEdgesSet = new Set<string>()
    const nextHandles = [firstNodeHandle]
    const streamInfo = {} as Record<string, NodeStreamInfo>
    const parallelListItem = {
      parallelNodeId: '',
      depth: 0,
    } as ParallelInfoItem // 某一个并行节点信息
    const nodeParallelInfoMap = {} as Record<string, NodeParallelInfo> // 并行节点信息map
    nodeParallelInfoMap[firstNodeHandle.node.id] = {
      parallelNodeId: '',
      edgeHandleId: '',
      depth: 0, // 当前节点的深度（层级）
    }

    while (nextHandles.length) {
      /**
       * currentNodeHandle 当前的节点
       * outgoers 获取当前节点连出的所有边的所有目标节点
       * depth 当前节点的深度（层级）
       */
      const currentNodeHandle = nextHandles.shift()!
      const { node: currentNode, handle: currentHandle = 'source' } = currentNodeHandle
      const currentNodeHandleKey = currentNode.id
      /**
       * 第一次是获取所有开始节点连出的边，后续是获取当前节点连出的边
       */
      const connectedEdges = edges.filter(edge => edge.source === currentNode.id && edge.sourceHandle === currentHandle)
      /**
       * 第一次是获取所有开始节点连出的边的长度，后续是获取当前节点连出的边的长度
       */
      const connectedEdgesLength = connectedEdges.length
      /**
       * 获取当前节点连出的所有边的所有目标节点
       */
      const outgoers = nodes.filter(node => connectedEdges.some(edge => edge.target === node.id))
      /**
       * 获取当前节点的所有直接上游节点
       */
      const incomers = getIncomers(currentNode, nodes, edges)

      if (!streamInfo[currentNodeHandleKey]) {
        streamInfo[currentNodeHandleKey] = {
          upstreamNodes: new Set<string>(), // 上游节点
          downstreamEdges: new Set<string>(), // 下游边
        }
      }

      if (nodeEdgesSet[currentNodeHandleKey]?.size > 0 && incomers.length > 1) {
        /**
         * 记录整个工作流从开始节点到当前节点总共有多少并行分支
         * key: index
         * value: 1735031820954(开始)-source-1735297151678(LLM)-target
         */
        const newSet = new Set<string>()
        for (const item of totalEdgesSet) {
          // 如果当前节点的下游边没有这个边，则将这个边加入到newSet中
          if (!streamInfo[currentNodeHandleKey].downstreamEdges.has(item))
            newSet.add(item)
        }
        /**
         * 如果经过当前节点的所有边和newSet相等，则将当前节点添加nextNodeHandles，从当前节点开始再进行判断
         */
        if (isEqual(nodeEdgesSet[currentNodeHandleKey], newSet)) {
          parallelListItem.depth = nodeParallelInfoMap[currentNode.id].depth
          nextNodeHandles.push({ node: currentNode, handle: currentHandle })
          break
        }
      }

      // 更新并行节点列表的深度
      if (nodeParallelInfoMap[currentNode.id].depth > parallelListItem.depth)
        parallelListItem.depth = nodeParallelInfoMap[currentNode.id].depth

      outgoers.forEach((outgoer) => {
        const outgoerConnectedEdges = getConnectedEdges([outgoer], edges).filter(edge => edge.source === outgoer.id) // 获取当前节点的所有直接下游边，即是从这个节点引出的边
        const sourceEdgesGroup = groupBy(outgoerConnectedEdges, 'sourceHandle')
        const incomers = getIncomers(outgoer, nodes, edges)

        // 如果当前节点有多个上游节点和下游节点，则认为是异常边
        if (outgoers.length > 1 && incomers.length > 1)
          hasAbnormalEdges = true

        Object.keys(sourceEdgesGroup).forEach((sourceHandle) => {
          nextHandles.push({ node: outgoer, handle: sourceHandle })
        })
        // 如果当前节点没有下游边，则初始化handle为source保存到nextHandles中
        if (!outgoerConnectedEdges.length)
          nextHandles.push({ node: outgoer, handle: 'source' })

        const outgoerKey = outgoer.id
        if (!nodeEdgesSet[outgoerKey])
          nodeEdgesSet[outgoerKey] = new Set<string>()

        if (nodeEdgesSet[currentNodeHandleKey]) {
          for (const item of nodeEdgesSet[currentNodeHandleKey])
            nodeEdgesSet[outgoerKey].add(item)
        }

        if (!streamInfo[outgoerKey]) {
          streamInfo[outgoerKey] = {
            upstreamNodes: new Set<string>(),
            downstreamEdges: new Set<string>(),
          }
        }

        if (!nodeParallelInfoMap[outgoer.id]) {
          nodeParallelInfoMap[outgoer.id] = {
            ...nodeParallelInfoMap[currentNode.id],
          }
        }

        if (connectedEdgesLength > 1) {
          const edge = connectedEdges.find(edge => edge.target === outgoer.id)!
          nodeEdgesSet[outgoerKey].add(edge.id)
          totalEdgesSet.add(edge.id)

          streamInfo[currentNodeHandleKey].downstreamEdges.add(edge.id)
          streamInfo[outgoerKey].upstreamNodes.add(currentNodeHandleKey)

          for (const item of streamInfo[currentNodeHandleKey].upstreamNodes)
            streamInfo[item].downstreamEdges.add(edge.id)

          if (!parallelListItem.parallelNodeId)
            parallelListItem.parallelNodeId = currentNode.id

          const prevDepth = nodeParallelInfoMap[currentNode.id].depth + 1
          const currentDepth = nodeParallelInfoMap[outgoer.id].depth

          nodeParallelInfoMap[outgoer.id].depth = Math.max(prevDepth, currentDepth)
        }
        else {
          for (const item of streamInfo[currentNodeHandleKey].upstreamNodes)
            streamInfo[outgoerKey].upstreamNodes.add(item)

          nodeParallelInfoMap[outgoer.id].depth = nodeParallelInfoMap[currentNode.id].depth
        }
      })
    }

    parallelList.push(parallelListItem)
  }

  while (nextNodeHandles.length) {
    const nodeHandle = nextNodeHandles.shift()!
    traverse(nodeHandle)
  }

  return {
    parallelList,
    hasAbnormalEdges,
  }
}

export const hasErrorHandleNode = (nodeType?: BlockEnum) => {
  return nodeType === BlockEnum.LLM || nodeType === BlockEnum.Tool || nodeType === BlockEnum.HttpRequest || nodeType === BlockEnum.Code
}

export const getEdgeColor = (nodeRunningStatus?: NodeRunningStatus, isFailBranch?: boolean) => {
  if (nodeRunningStatus === NodeRunningStatus.Succeeded)
    return 'var(--color-workflow-link-line-success-handle)'

  if (nodeRunningStatus === NodeRunningStatus.Failed)
    return 'var(--color-workflow-link-line-error-handle)'

  if (nodeRunningStatus === NodeRunningStatus.Exception)
    return 'var(--color-workflow-link-line-failure-handle)'

  if (nodeRunningStatus === NodeRunningStatus.Running) {
    if (isFailBranch)
      return 'var(--color-workflow-link-line-failure-handle)'

    return 'var(--color-workflow-link-line-handle)'
  }

  return 'var(--color-workflow-link-line-normal)'
}

export const isExceptionVariable = (variable: string, nodeType?: BlockEnum) => {
  if ((variable === 'error_message' || variable === 'error_type') && hasErrorHandleNode(nodeType))
    return true

  return false
}

export const hasRetryNode = (nodeType?: BlockEnum) => {
  return nodeType === BlockEnum.LLM || nodeType === BlockEnum.Tool || nodeType === BlockEnum.HttpRequest || nodeType === BlockEnum.Code
}
