import { useCallback } from 'react'
import produce from 'immer'
import type {
  EdgeMouseHandler,
  OnEdgesChange,
} from 'reactflow'
import {
  useStoreApi,
} from 'reactflow'
import type {
  Node,
} from '../types'
import { getNodesConnectedSourceOrTargetHandleIdsMap } from '../utils'
import { useNodesSyncDraft } from './use-nodes-sync-draft'
import { useNodesReadOnly } from './use-workflow'
import { WorkflowHistoryEvent, useWorkflowHistory } from './use-workflow-history'

export const useEdgesInteractions = () => {
  const store = useStoreApi()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const { getNodesReadOnly } = useNodesReadOnly()
  const { saveStateToHistory } = useWorkflowHistory()

  /**
   * 处理鼠标进入边（hover，click等）
   */
  const handleEdgeEnter = useCallback<EdgeMouseHandler>((_, edge) => {
    if (getNodesReadOnly())
      return

    const {
      edges,
      setEdges,
    } = store.getState()
    // 只是修改当前 edge 是否被 enter 的状态
    const newEdges = produce(edges, (draft) => {
      const currentEdge = draft.find(e => e.id === edge.id)!

      currentEdge.data._hovering = true
    })
    setEdges(newEdges)
  }, [store, getNodesReadOnly])

  /**
   * 处理鼠标离开边（leave）
   */
  const handleEdgeLeave = useCallback<EdgeMouseHandler>((_, edge) => {
    if (getNodesReadOnly())
      return

    const {
      edges,
      setEdges,
    } = store.getState()
    // 只是修改当前 edge 是否被 leave 的状态
    const newEdges = produce(edges, (draft) => {
      const currentEdge = draft.find(e => e.id === edge.id)!

      currentEdge.data._hovering = false
    })
    setEdges(newEdges)
  }, [store, getNodesReadOnly])

  /**
   * 处理删除分支时删除所有的边
   */
  const handleEdgeDeleteByDeleteBranch = useCallback((nodeId: string, branchId: string) => {
    if (getNodesReadOnly())
      return

    const {
      getNodes,
      setNodes,
      edges,
      setEdges,
    } = store.getState()
    // 找到所有需要删除的边
    const edgeWillBeDeleted = edges.filter(edge => edge.source === nodeId && edge.sourceHandle === branchId)

    if (!edgeWillBeDeleted.length)
      return

    const nodes = getNodes()
    const nodesConnectedSourceOrTargetHandleIdsMap = getNodesConnectedSourceOrTargetHandleIdsMap(
      edgeWillBeDeleted.map(edge => ({ type: 'remove', edge })),
      nodes,
    )
    // 更新节点的额外数据（nodesConnectedSourceOrTargetHandleIdsMap）
    const newNodes = produce(nodes, (draft: Node[]) => {
      draft.forEach((node) => {
        if (nodesConnectedSourceOrTargetHandleIdsMap[node.id]) {
          node.data = {
            ...node.data,
            ...nodesConnectedSourceOrTargetHandleIdsMap[node.id],
          }
        }
      })
    })
    setNodes(newNodes)
    // 过滤掉需要删除的边
    const newEdges = produce(edges, (draft) => {
      return draft.filter(edge => !edgeWillBeDeleted.find(e => e.id === edge.id))
    })
    setEdges(newEdges)
    handleSyncWorkflowDraft()
    // 记录触发事件，保存工作流数据到历史记录
    saveStateToHistory(WorkflowHistoryEvent.EdgeDeleteByDeleteBranch)
  }, [getNodesReadOnly, store, handleSyncWorkflowDraft, saveStateToHistory])

  /**
   * 处理删除边
   */
  const handleEdgeDelete = useCallback(() => {
    if (getNodesReadOnly())
      return

    const {
      getNodes,
      setNodes,
      edges,
      setEdges,
    } = store.getState()
    const currentEdgeIndex = edges.findIndex(edge => edge.selected)

    if (currentEdgeIndex < 0)
      return
    const currentEdge = edges[currentEdgeIndex]
    const nodes = getNodes()
    const nodesConnectedSourceOrTargetHandleIdsMap = getNodesConnectedSourceOrTargetHandleIdsMap(
      [
        { type: 'remove', edge: currentEdge }, // 标记为 remove
      ],
      nodes,
    )
    const newNodes = produce(nodes, (draft: Node[]) => {
      draft.forEach((node) => {
        if (nodesConnectedSourceOrTargetHandleIdsMap[node.id]) {
          node.data = {
            ...node.data,
            ...nodesConnectedSourceOrTargetHandleIdsMap[node.id],
          }
        }
      })
    })
    setNodes(newNodes)
    const newEdges = produce(edges, (draft) => {
      draft.splice(currentEdgeIndex, 1)
    })
    setEdges(newEdges)
    handleSyncWorkflowDraft()
    saveStateToHistory(WorkflowHistoryEvent.EdgeDelete)
  }, [getNodesReadOnly, store, handleSyncWorkflowDraft, saveStateToHistory])

  /**
   * 处理边的变化
   */
  const handleEdgesChange = useCallback<OnEdgesChange>((changes) => {
    if (getNodesReadOnly())
      return

    const {
      edges,
      setEdges,
    } = store.getState()

    const newEdges = produce(edges, (draft) => {
      changes.forEach((change) => {
        //  更新边的选中状态, type 总共有四种："add" | "remove" | "select" | "reset"
        if (change.type === 'select')
          draft.find(edge => edge.id === change.id)!.selected = change.selected
      })
    })
    setEdges(newEdges)
  }, [store, getNodesReadOnly])

  /**
   * 处理取消边的运行状态
   */
  const handleEdgeCancelRunningStatus = useCallback(() => {
    const {
      edges,
      setEdges,
    } = store.getState()

    const newEdges = produce(edges, (draft) => {
      draft.forEach((edge) => {
        edge.data._sourceRunningStatus = undefined
        edge.data._targetRunningStatus = undefined
        edge.data._waitingRun = false
      })
    })
    setEdges(newEdges)
  }, [store])

  return {
    handleEdgeEnter,
    handleEdgeLeave,
    handleEdgeDeleteByDeleteBranch,
    handleEdgeDelete,
    handleEdgesChange,
    handleEdgeCancelRunningStatus,
  }
}
