import { useCallback } from 'react'
import produce from 'immer'
import { useStoreApi } from 'reactflow'
import { useNodesSyncDraft } from './use-nodes-sync-draft'
import { useNodesReadOnly } from './use-workflow'

type NodeDataUpdatePayload = {
  id: string
  data: Record<string, any>
}

export const useNodeDataUpdate = () => {
  const store = useStoreApi()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const { getNodesReadOnly } = useNodesReadOnly()

  /**
   * 更新节点数据，只更新节点数据
   */
  const handleNodeDataUpdate = useCallback(({ id, data }: NodeDataUpdatePayload) => {
    const {
      getNodes,
      setNodes,
    } = store.getState()
    const newNodes = produce(getNodes(), (draft) => {
      const currentNode = draft.find(node => node.id === id)!

      if (currentNode)
        currentNode.data = { ...currentNode.data, ...data }
    })
    setNodes(newNodes)
  }, [store])

  /**
   * 更新节点数据，并同时更新工作流草稿（立即更新）
   */
  const handleNodeDataUpdateWithSyncDraft = useCallback((payload: NodeDataUpdatePayload) => {
    if (getNodesReadOnly())
      return

    handleNodeDataUpdate(payload)
    handleSyncWorkflowDraft()
  }, [handleSyncWorkflowDraft, handleNodeDataUpdate, getNodesReadOnly])

  return {
    handleNodeDataUpdate,
    handleNodeDataUpdateWithSyncDraft,
  }
}
