import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import dayjs from 'dayjs'
import { uniqBy } from 'lodash-es'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import {
  getIncomers, // 获取给定节点的所有直接上游节点，只会追溯一层的关系
  getOutgoers, // 获取给定节点的所有直接下游节点，只会追溯一层的关系
  useStoreApi, // 访问 ReactFlow 的内部存储 API。这个存储 API 包含了 ReactFlow 组件的各种状态信息，例如节点信息、边信息、视图状态等。
} from 'reactflow'
import type {
  Connection,
} from 'reactflow'
import type {
  Edge,
  Node,
  ValueSelector,
} from '../types'
import {
  BlockEnum,
  WorkflowRunningStatus,
} from '../types'
import {
  useStore,
  useWorkflowStore,
} from '../store'
import {
  getParallelInfo,
} from '../utils'
import {
  PARALLEL_DEPTH_LIMIT,
  PARALLEL_LIMIT,
  SUPPORT_OUTPUT_VARS_NODE,
} from '../constants'
import { CUSTOM_NOTE_NODE } from '../note-node/constants'
import { findUsedVarNodes, getNodeOutputVars, updateNodeVars } from '../nodes/_base/components/variable/utils'
import { useNodesExtraData } from './use-nodes-data'
import { useWorkflowTemplate } from './use-workflow-template'
import { useStore as useAppStore } from '@/app/components/app/store'
import {
  fetchNodesDefaultConfigs,
  fetchPublishedWorkflow,
  fetchWorkflowDraft,
  syncWorkflowDraft,
} from '@/service/workflow'
import type { FetchWorkflowDraftResponse } from '@/types/workflow'
import {
  fetchAllBuiltInTools,
  fetchAllCustomTools,
  fetchAllWorkflowTools,
} from '@/service/tools'
import I18n from '@/context/i18n'
import { CollectionType } from '@/app/components/tools/types'
import { CUSTOM_ITERATION_START_NODE } from '@/app/components/workflow/nodes/iteration-start/constants'
import { useWorkflowConfig } from '@/service/use-workflow'

/**
 * 判断是哪种flow类型（chatflow、工作流）
 * chatflow: advanced-chat
 * @returns
 */
export const useIsChatMode = () => {
  const appDetail = useAppStore(s => s.appDetail)

  return appDetail?.mode === 'advanced-chat'
}

export const useWorkflow = () => {
  const { t } = useTranslation()
  const { locale } = useContext(I18n)
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const appId = useStore(s => s.appId)
  const nodesExtraData = useNodesExtraData()
  // 获取工作流配置
  const { data: workflowConfig } = useWorkflowConfig(appId)
  // 设置面板宽度
  const setPanelWidth = useCallback((width: number) => {
    localStorage.setItem('workflow-node-panel-width', `${width}`)
    workflowStore.setState({ panelWidth: width })
  }, [workflowStore])

  /**
   * 获取给定节点的所有叶子节点
   */
  const getTreeLeafNodes = useCallback((nodeId: string) => {
    const {
      getNodes,
      edges,
    } = store.getState()
    const nodes = getNodes()
    let startNode = nodes.find(node => node.data.type === BlockEnum.Start)
    const currentNode = nodes.find(node => node.id === nodeId)

    // 针对当前节点是迭代节点的情况
    if (currentNode?.parentId)
      startNode = nodes.find(node => node.parentId === currentNode.parentId && node.type === CUSTOM_ITERATION_START_NODE)

    if (!startNode)
      return []

    const list: Node[] = []
    /**
     * 前序
     * @param root
     * @param callback
     * @returns
     */
    const preOrder = (root: Node, callback: (node: Node) => void) => {
      if (root.id === nodeId)
        return
      const outgoers = getOutgoers(root, nodes, edges)

      if (outgoers.length) {
        outgoers.forEach((outgoer) => {
          preOrder(outgoer, callback)
        })
      }
      else {
        if (root.id !== nodeId)
          callback(root)
      }
    }
    preOrder(startNode, (node) => {
      list.push(node)
    })

    // 获取给定节点的所有上游节点
    const incomers = getIncomers({ id: nodeId } as Node, nodes, edges)

    list.push(...incomers)

    // 过滤出支持输出变量的节点
    return uniqBy(list, 'id').filter((item) => {
      return SUPPORT_OUTPUT_VARS_NODE.includes(item.data.type)
    })
  }, [store])

  /**
   * 获取相同分支上的所有前置节点
   */
  const getBeforeNodesInSameBranch = useCallback((nodeId: string, newNodes?: Node[], newEdges?: Edge[]) => {
    const {
      getNodes,
      edges,
    } = store.getState()
    const nodes = newNodes || getNodes()
    const currentNode = nodes.find(node => node.id === nodeId)

    const list: Node[] = []

    if (!currentNode)
      return list

    // 针对当前节点是迭代节点的情况，可以理解为将将迭代节点内的所有节点视为一个新的整体
    if (currentNode.parentId) {
      const parentNode = nodes.find(node => node.id === currentNode.parentId)
      if (parentNode) {
        const parentList = getBeforeNodesInSameBranch(parentNode.id)

        list.push(...parentList)
      }
    }

    // 遍历保存所有前置节点
    const traverse = (root: Node, callback: (node: Node) => void) => {
      if (root) {
        const incomers = getIncomers(root, nodes, newEdges || edges)

        if (incomers.length) {
          incomers.forEach((node) => {
            // 递归获取所有前置节点过程中可能会导致一些节点被重复计算，所以需要去重判断
            if (!list.find(n => node.id === n.id)) {
              callback(node)
              traverse(node, callback) // 递归处理，所以可以获取所有的前置节点
            }
          })
        }
      }
    }
    traverse(currentNode, (node) => {
      list.push(node)
    })

    const length = list.length
    if (length) {
      // 按照节点在工作流中的顺序返回节点列表，所以需要 reverse 一下，并且只返回支持输出变量的节点
      return uniqBy(list, 'id').reverse().filter((item) => {
        return SUPPORT_OUTPUT_VARS_NODE.includes(item.data.type)
      })
    }

    return []
  }, [store])

  /**
   * 获取相同分支上的所有前置节点，包括父节点
   */
  const getBeforeNodesInSameBranchIncludeParent = useCallback((nodeId: string, newNodes?: Node[], newEdges?: Edge[]) => {
    const nodes = getBeforeNodesInSameBranch(nodeId, newNodes, newEdges)
    const {
      getNodes,
    } = store.getState()
    const allNodes = getNodes()
    const node = allNodes.find(n => n.id === nodeId)
    const parentNodeId = node?.parentId
    const parentNode = allNodes.find(n => n.id === parentNodeId)
    if (parentNode)
      nodes.push(parentNode)

    return nodes
  }, [getBeforeNodesInSameBranch, store])

  /**
   * 获取相同分支上的所有后置节点
   */
  const getAfterNodesInSameBranch = useCallback((nodeId: string) => {
    const {
      getNodes,
      edges,
    } = store.getState()
    const nodes = getNodes()
    const currentNode = nodes.find(node => node.id === nodeId)!

    if (!currentNode)
      return []
    const list: Node[] = [currentNode]

    const traverse = (root: Node, callback: (node: Node) => void) => {
      if (root) {
        const outgoers = getOutgoers(root, nodes, edges)

        if (outgoers.length) {
          outgoers.forEach((node) => {
            callback(node)
            traverse(node, callback)
          })
        }
      }
    }
    traverse(currentNode, (node) => {
      list.push(node)
    })

    return uniqBy(list, 'id')
  }, [store])

  /**
   * 获取给定节点的所有直接上游节点，只会追溯一层的关系
   */
  const getBeforeNodeById = useCallback((nodeId: string) => {
    const {
      getNodes,
      edges,
    } = store.getState()
    const nodes = getNodes()
    const node = nodes.find(node => node.id === nodeId)!

    return getIncomers(node, nodes, edges)
  }, [store])

  /**
   * 获取迭代节点里面的所有子节点
   * 迭代节点的规则是迭代节点里面所有节点的parentId都是迭代节点的id
   */
  const getIterationNodeChildren = useCallback((nodeId: string) => {
    const {
      getNodes,
    } = store.getState()
    const nodes = getNodes()

    return nodes.filter(node => node.parentId === nodeId)
  }, [store])

  /**
   * 判断当前节点是否是从开始节点开始的
   */
  const isFromStartNode = useCallback((nodeId: string) => {
    const { getNodes } = store.getState()
    const nodes = getNodes()
    const currentNode = nodes.find(node => node.id === nodeId)

    if (!currentNode)
      return false

    if (currentNode.data.type === BlockEnum.Start)
      return true

    const checkPreviousNodes = (node: Node) => {
      const previousNodes = getBeforeNodeById(node.id)

      for (const prevNode of previousNodes) {
        if (prevNode.data.type === BlockEnum.Start)
          return true
        if (checkPreviousNodes(prevNode))
          return true
      }

      return false
    }

    return checkPreviousNodes(currentNode)
  }, [store, getBeforeNodeById])

  /**
   * 处理将当前节点的输出变量重命名，同时更新当前节点在同一分支下后续节点所有使用了当前节点输出变量的节点
   */
  const handleOutVarRenameChange = useCallback((nodeId: string, oldValueSelector: ValueSelector, newVarSelector: ValueSelector) => {
    const { getNodes, setNodes } = store.getState()
    const afterNodes = getAfterNodesInSameBranch(nodeId)
    const effectNodes = findUsedVarNodes(oldValueSelector, afterNodes)
    if (effectNodes.length > 0) {
      const newNodes = getNodes().map((node) => {
        if (effectNodes.find(n => n.id === node.id))
          return updateNodeVars(node, oldValueSelector, newVarSelector)

        return node
      })
      setNodes(newNodes)
    }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store])

  /**
   * 判断当前变量选择器是否在当前分支的后续节点中使用
   */
  const isVarUsedInNodes = useCallback((varSelector: ValueSelector) => {
    const nodeId = varSelector[0]
    const afterNodes = getAfterNodesInSameBranch(nodeId)
    const effectNodes = findUsedVarNodes(varSelector, afterNodes)
    return effectNodes.length > 0
  }, [getAfterNodesInSameBranch])

  /**
   * 移除当前分支的后续节点中使用了当前变量选择器的节点中的变量选择器
   */
  const removeUsedVarInNodes = useCallback((varSelector: ValueSelector) => {
    const nodeId = varSelector[0]
    const { getNodes, setNodes } = store.getState()
    const afterNodes = getAfterNodesInSameBranch(nodeId)
    const effectNodes = findUsedVarNodes(varSelector, afterNodes)
    if (effectNodes.length > 0) {
      const newNodes = getNodes().map((node) => {
        if (effectNodes.find(n => n.id === node.id))
          return updateNodeVars(node, varSelector, [])

        return node
      })
      setNodes(newNodes)
    }
  }, [getAfterNodesInSameBranch, store])

  /**
   * 判断当前节点的输出变量是否在当前分支的后续节点中使用
   */
  const isNodeVarsUsedInNodes = useCallback((node: Node, isChatMode: boolean) => {
    const outputVars = getNodeOutputVars(node, isChatMode)
    const isUsed = outputVars.some((varSelector) => {
      return isVarUsedInNodes(varSelector)
    })
    return isUsed
  }, [isVarUsedInNodes])

  /**
   * 检查当前节点是否超过最大并行分支限制
   */
  const checkParallelLimit = useCallback((nodeId: string, nodeHandle = 'source') => {
    const {
      edges,
    } = store.getState()
    const connectedEdges = edges.filter(edge => edge.source === nodeId && edge.sourceHandle === nodeHandle)
    if (connectedEdges.length > PARALLEL_LIMIT - 1) {
      const { setShowTips } = workflowStore.getState()
      setShowTips(t('workflow.common.parallelTip.limit', { num: PARALLEL_LIMIT }))
      return false
    }

    return true
  }, [store, workflowStore, t])

  /**
   * 检查节点是否超过嵌套并行限制
   */
  const checkNestedParallelLimit = useCallback((nodes: Node[], edges: Edge[], parentNodeId?: string) => {
    const {
      parallelList,
      hasAbnormalEdges,
    } = getParallelInfo(nodes, edges, parentNodeId)

    if (hasAbnormalEdges)
      return false

    for (let i = 0; i < parallelList.length; i++) {
      const parallel = parallelList[i]

      // 检查是否超过最大并行嵌套层数
      if (parallel.depth > (workflowConfig?.parallel_depth_limit || PARALLEL_DEPTH_LIMIT)) {
        const { setShowTips } = workflowStore.getState()
        setShowTips(t('workflow.common.parallelTip.depthLimit', { num: (workflowConfig?.parallel_depth_limit || PARALLEL_DEPTH_LIMIT) }))
        return false
      }
    }

    return true
  }, [t, workflowStore, workflowConfig?.parallel_depth_limit])

  /**
   * 判断两个节点是否可以连接（是否是有效的连接）
   * @param source 源节点 ID
   * @param sourceHandle 源节点连接点
   * @param target 目标节点 ID
   * @returns
   */
  const isValidConnection = useCallback(({ source, sourceHandle, target }: Connection) => {
    const {
      edges,
      getNodes,
    } = store.getState()
    const nodes = getNodes()
    const sourceNode: Node = nodes.find(node => node.id === source)!
    const targetNode: Node = nodes.find(node => node.id === target)!

    if (!checkParallelLimit(source!, sourceHandle || 'source'))
      return false

    if (sourceNode.type === CUSTOM_NOTE_NODE || targetNode.type === CUSTOM_NOTE_NODE)
      return false

    if (sourceNode.parentId !== targetNode.parentId)
      return false

    if (sourceNode && targetNode) {
      const sourceNodeAvailableNextNodes = nodesExtraData[sourceNode.data.type].availableNextNodes
      const targetNodeAvailablePrevNodes = [...nodesExtraData[targetNode.data.type].availablePrevNodes, BlockEnum.Start]

      if (!sourceNodeAvailableNextNodes.includes(targetNode.data.type))
        return false

      if (!targetNodeAvailablePrevNodes.includes(sourceNode.data.type))
        return false
    }

    /**
     * 判断是否有环
     * @param node
     * @param visited
     * @returns
     */
    const hasCycle = (node: Node, visited = new Set()) => {
      if (visited.has(node.id))
        return false

      visited.add(node.id)

      for (const outgoer of getOutgoers(node, nodes, edges)) {
        if (outgoer.id === source)
          return true
        if (hasCycle(outgoer, visited))
          return true
      }
    }

    return !hasCycle(targetNode)
  }, [store, nodesExtraData, checkParallelLimit])

  /**
   * 格式化时间
   */
  const formatTimeFromNow = useCallback((time: number) => {
    return dayjs(time).locale(locale === 'zh-Hans' ? 'zh-cn' : locale).fromNow()
  }, [locale])

  /**
   * 根据节点ID获取目标节点，如果没有找到目标节点，则返回开始节点
   */
  const getNode = useCallback((nodeId?: string) => {
    const { getNodes } = store.getState()
    const nodes = getNodes()

    return nodes.find(node => node.id === nodeId) || nodes.find(node => node.data.type === BlockEnum.Start)
  }, [store])

  return {
    setPanelWidth,
    getTreeLeafNodes,
    getBeforeNodesInSameBranch,
    getBeforeNodesInSameBranchIncludeParent,
    getAfterNodesInSameBranch,
    handleOutVarRenameChange,
    isVarUsedInNodes,
    removeUsedVarInNodes,
    isNodeVarsUsedInNodes,
    checkParallelLimit,
    checkNestedParallelLimit,
    isValidConnection,
    isFromStartNode,
    formatTimeFromNow,
    getNode,
    getBeforeNodeById,
    getIterationNodeChildren,
  }
}

/**
 * 设置工作流工具数据
 * @returns
 */
export const useFetchToolsData = () => {
  const workflowStore = useWorkflowStore()

  const handleFetchAllTools = useCallback(async (type: string) => {
    if (type === 'builtin') {
      const buildInTools = await fetchAllBuiltInTools()

      workflowStore.setState({
        buildInTools: buildInTools || [],
      })
    }
    if (type === 'custom') {
      const customTools = await fetchAllCustomTools()

      workflowStore.setState({
        customTools: customTools || [],
      })
    }
    if (type === 'workflow') {
      const workflowTools = await fetchAllWorkflowTools()

      workflowStore.setState({
        workflowTools: workflowTools || [],
      })
    }
  }, [workflowStore])

  return {
    handleFetchAllTools,
  }
}

/**
 * 初始化一些工作流数据
 * @returns #{data: 工作流数据, isLoading: 是否正在获取数据或者正在初始化}
 */
export const useWorkflowInit = () => {
  const workflowStore = useWorkflowStore()
  const {
    nodes: nodesTemplate,
    edges: edgesTemplate,
  } = useWorkflowTemplate()
  const { handleFetchAllTools } = useFetchToolsData()
  const appDetail = useAppStore(state => state.appDetail)!
  const setSyncWorkflowDraftHash = useStore(s => s.setSyncWorkflowDraftHash)
  const [data, setData] = useState<FetchWorkflowDraftResponse>()
  const [isLoading, setIsLoading] = useState(true)
  useEffect(() => {
    workflowStore.setState({ appId: appDetail.id })
  }, [appDetail.id, workflowStore])

  /**
   * 获取工作流草稿数据
   * 如果报错了并且报错信息是 draft_workflow_not_exist，则先创建并保存一个草稿，然后再获取草稿数据
   */
  const handleGetInitialWorkflowData = useCallback(async () => {
    try {
      const res = await fetchWorkflowDraft(`/apps/${appDetail.id}/workflows/draft`)
      setData(res)
      workflowStore.setState({
        envSecrets: (res.environment_variables || []).filter(env => env.value_type === 'secret').reduce((acc, env) => {
          acc[env.id] = env.value
          return acc
        }, {} as Record<string, string>),
        environmentVariables: res.environment_variables?.map(env => env.value_type === 'secret' ? { ...env, value: '[__HIDDEN__]' } : env) || [],
        // #TODO chatVar sync#
        conversationVariables: res.conversation_variables || [],
      })
      setSyncWorkflowDraftHash(res.hash)
      setIsLoading(false)
    }
    catch (error: any) {
      if (error && error.json && !error.bodyUsed && appDetail) {
        error.json().then((err: any) => {
          if (err.code === 'draft_workflow_not_exist') {
            workflowStore.setState({ notInitialWorkflow: true })
            syncWorkflowDraft({
              url: `/apps/${appDetail.id}/workflows/draft`,
              params: {
                graph: {
                  nodes: nodesTemplate,
                  edges: edgesTemplate,
                },
                features: {
                  retriever_resource: { enabled: true },
                },
                environment_variables: [],
                conversation_variables: [],
              },
            }).then((res) => {
              workflowStore.getState().setDraftUpdatedAt(res.updated_at)
              handleGetInitialWorkflowData()
            })
          }
        })
      }
    }
  }, [appDetail, nodesTemplate, edgesTemplate, workflowStore, setSyncWorkflowDraftHash])

  useEffect(() => {
    handleGetInitialWorkflowData()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * 获取工作流预加载数据
   * 默认配置信息、发布时间等
   */
  const handleFetchPreloadData = useCallback(async () => {
    try {
      const nodesDefaultConfigsData = await fetchNodesDefaultConfigs(`/apps/${appDetail?.id}/workflows/default-workflow-block-configs`)
      const publishedWorkflow = await fetchPublishedWorkflow(`/apps/${appDetail?.id}/workflows/publish`)
      workflowStore.setState({
        nodesDefaultConfigs: nodesDefaultConfigsData.reduce((acc, block) => {
          if (!acc[block.type])
            acc[block.type] = { ...block.config }
          return acc
        }, {} as Record<string, any>),
      })
      workflowStore.getState().setPublishedAt(publishedWorkflow?.created_at)
    }
    catch (e) {

    }
  }, [workflowStore, appDetail])

  useEffect(() => {
    handleFetchPreloadData()
    handleFetchAllTools('builtin')
    handleFetchAllTools('custom')
    handleFetchAllTools('workflow')
  }, [handleFetchPreloadData, handleFetchAllTools])

  useEffect(() => {
    if (data) {
      workflowStore.getState().setDraftUpdatedAt(data.updated_at)
      workflowStore.getState().setToolPublished(data.tool_published)
    }
  }, [data, workflowStore])

  return {
    data,
    isLoading,
  }
}

/**
 * 判断工作流是否是只读状态
 * @returns
 */
export const useWorkflowReadOnly = () => {
  const workflowStore = useWorkflowStore()
  const workflowRunningData = useStore(s => s.workflowRunningData)

  const getWorkflowReadOnly = useCallback(() => {
    return workflowStore.getState().workflowRunningData?.result.status === WorkflowRunningStatus.Running
  }, [workflowStore])

  return {
    workflowReadOnly: workflowRunningData?.result.status === WorkflowRunningStatus.Running,
    getWorkflowReadOnly,
  }
}

/**
 * 判断节点是否是只读状态
 * @returns
 */
export const useNodesReadOnly = () => {
  const workflowStore = useWorkflowStore()
  const workflowRunningData = useStore(s => s.workflowRunningData)
  const historyWorkflowData = useStore(s => s.historyWorkflowData)
  const isRestoring = useStore(s => s.isRestoring)

  /**
   * 判断节点是否正在运行中，如果没有正在运行中，则返回历史数据，如果没有历史数据，则返回是否正在恢复中
   */
  const getNodesReadOnly = useCallback(() => {
    const {
      workflowRunningData,
      historyWorkflowData,
      isRestoring,
    } = workflowStore.getState()

    return workflowRunningData?.result.status === WorkflowRunningStatus.Running || historyWorkflowData || isRestoring
  }, [workflowStore])

  return {
    nodesReadOnly: !!(workflowRunningData?.result.status === WorkflowRunningStatus.Running || historyWorkflowData || isRestoring), // 节点是否只读
    getNodesReadOnly,
  }
}

/**
 * 获取工具里的各种工具节点图标
 * @param data
 * @returns
 */
export const useToolIcon = (data: Node['data']) => {
  const buildInTools = useStore(s => s.buildInTools)
  const customTools = useStore(s => s.customTools)
  const workflowTools = useStore(s => s.workflowTools)
  const toolIcon = useMemo(() => {
    if (data.type === BlockEnum.Tool) {
      let targetTools = buildInTools
      if (data.provider_type === CollectionType.builtIn)
        targetTools = buildInTools
      else if (data.provider_type === CollectionType.custom)
        targetTools = customTools
      else
        targetTools = workflowTools
      return targetTools.find(toolWithProvider => toolWithProvider.id === data.provider_id)?.icon
    }
  }, [data, buildInTools, customTools, workflowTools])

  return toolIcon
}

/**
 * 判断节点是否是迭代节点
 */
export const useIsNodeInIteration = (iterationId: string) => {
  const store = useStoreApi()

  const isNodeInIteration = useCallback((nodeId: string) => {
    const {
      getNodes,
    } = store.getState()
    const nodes = getNodes()
    const node = nodes.find(node => node.id === nodeId)

    if (!node)
      return false

    if (node.parentId === iterationId)
      return true

    return false
  }, [iterationId, store])
  return {
    isNodeInIteration,
  }
}
