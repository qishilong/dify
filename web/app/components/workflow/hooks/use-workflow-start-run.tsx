import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import { useWorkflowStore } from '../store'
import {
  BlockEnum,
  WorkflowRunningStatus,
} from '../types'
import {
  useIsChatMode,
  useNodesSyncDraft,
  useWorkflowInteractions,
  useWorkflowRun,
} from './index'
import { useFeaturesStore } from '@/app/components/base/features/hooks'

/**
 * 与flow开始运行有关
 * @returns {Object} 返回与flow开始运行有关的函数
 * @returns {Function} handleWorkflowStartRunInWorkflow - 在workflow中开始运行
 * @returns {Function} handleWorkflowStartRunInChatflow - 在chatflow中开始运行
 * @returns {Function} handleWorkflowStartRun - 统一处理flow开始运行
 */
export const useWorkflowStartRun = () => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const featuresStore = useFeaturesStore()
  const isChatMode = useIsChatMode()
  const { handleCancelDebugAndPreviewPanel } = useWorkflowInteractions()
  const { handleRun } = useWorkflowRun()
  const { doSyncWorkflowDraft } = useNodesSyncDraft()

  /**
   * 处理在workflow中开始运行
   */
  const handleWorkflowStartRunInWorkflow = useCallback(async () => {
    const {
      workflowRunningData,
    } = workflowStore.getState()

    if (workflowRunningData?.result.status === WorkflowRunningStatus.Running)
      return

    const { getNodes } = store.getState()
    const nodes = getNodes()
    const startNode = nodes.find(node => node.data.type === BlockEnum.Start)
    const startVariables = startNode?.data.variables || []
    const fileSettings = featuresStore!.getState().features.file
    const {
      showDebugAndPreviewPanel,
      setShowDebugAndPreviewPanel,
      setShowInputsPanel,
      setShowEnvPanel,
    } = workflowStore.getState()

    setShowEnvPanel(false)

    if (showDebugAndPreviewPanel) {
      handleCancelDebugAndPreviewPanel()
      return
    }

    if (!startVariables.length && !fileSettings?.image?.enabled) {
      await doSyncWorkflowDraft()
      handleRun({ inputs: {}, files: [] })
      setShowDebugAndPreviewPanel(true)
      setShowInputsPanel(false)
    }
    else {
      setShowDebugAndPreviewPanel(true)
      setShowInputsPanel(true)
    }
  }, [store, workflowStore, featuresStore, handleCancelDebugAndPreviewPanel, handleRun, doSyncWorkflowDraft])

  /**
   * 处理在chatflow中开始运行
   */
  const handleWorkflowStartRunInChatflow = useCallback(async () => {
    const {
      showDebugAndPreviewPanel,
      setShowDebugAndPreviewPanel,
      setHistoryWorkflowData,
      setShowEnvPanel,
      setShowChatVariablePanel,
    } = workflowStore.getState()

    setShowEnvPanel(false)
    setShowChatVariablePanel(false)

    if (showDebugAndPreviewPanel)
      handleCancelDebugAndPreviewPanel()
    else
      setShowDebugAndPreviewPanel(true)

    setHistoryWorkflowData(undefined)
  }, [workflowStore, handleCancelDebugAndPreviewPanel])

  /**
   * 统一处理flow开始运行
   */
  const handleStartWorkflowRun = useCallback(() => {
    if (!isChatMode)
      handleWorkflowStartRunInWorkflow()
    else
      handleWorkflowStartRunInChatflow()
  }, [isChatMode, handleWorkflowStartRunInWorkflow, handleWorkflowStartRunInChatflow])

  return {
    handleStartWorkflowRun,
    handleWorkflowStartRunInWorkflow,
    handleWorkflowStartRunInChatflow,
  }
}
