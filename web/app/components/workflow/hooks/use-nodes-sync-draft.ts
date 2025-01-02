import { useCallback } from 'react'
import produce from 'immer'
import { useStoreApi } from 'reactflow'
import { useParams } from 'next/navigation'
import {
  useStore,
  useWorkflowStore,
} from '../store'
import { BlockEnum } from '../types'
import { useWorkflowUpdate } from '../hooks'
import {
  useNodesReadOnly,
} from './use-workflow'
import { syncWorkflowDraft } from '@/service/workflow'
import { useFeaturesStore } from '@/app/components/base/features/hooks'
import { API_PREFIX } from '@/config'

export const useNodesSyncDraft = () => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const featuresStore = useFeaturesStore()
  const { getNodesReadOnly } = useNodesReadOnly()
  const { handleRefreshWorkflowDraft } = useWorkflowUpdate()
  const debouncedSyncWorkflowDraft = useStore(s => s.debouncedSyncWorkflowDraft)
  const params = useParams()

  /**
   * 获取发送post-draft请求的参数
   */
  const getPostParams = useCallback(() => {
    const {
      getNodes,
      edges,
      transform,
    } = store.getState()
    const [x, y, zoom] = transform
    const {
      appId,
      conversationVariables,
      environmentVariables,
      syncWorkflowDraftHash,
    } = workflowStore.getState()

    if (appId) {
      const nodes = getNodes()
      const hasStartNode = nodes.find(node => node.data.type === BlockEnum.Start)

      // 没有开始节点，不保存
      if (!hasStartNode)
        return

      const features = featuresStore!.getState().features
      // 删除掉多余的数据，_ 开头的数据
      const producedNodes = produce(nodes, (draft) => {
        draft.forEach((node) => {
          Object.keys(node.data).forEach((key) => {
            if (key.startsWith('_'))
              delete node.data[key]
          })
        })
      })
      // 删除掉多余的数据，_ 开头的数据
      const producedEdges = produce(edges, (draft) => {
        draft.forEach((edge) => {
          Object.keys(edge.data).forEach((key) => {
            if (key.startsWith('_'))
              delete edge.data[key]
          })
        })
      })
      return {
        url: `/apps/${appId}/workflows/draft`,
        params: {
          graph: {
            nodes: producedNodes,
            edges: producedEdges,
            viewport: {
              x,
              y,
              zoom,
            },
          },
          features: {
            opening_statement: features.opening?.enabled ? (features.opening?.opening_statement || '') : '',
            suggested_questions: features.opening?.enabled ? (features.opening?.suggested_questions || []) : [],
            suggested_questions_after_answer: features.suggested,
            text_to_speech: features.text2speech,
            speech_to_text: features.speech2text,
            retriever_resource: features.citation,
            sensitive_word_avoidance: features.moderation,
            file_upload: features.file,
          },
          environment_variables: environmentVariables,
          conversation_variables: conversationVariables,
          hash: syncWorkflowDraftHash,
        },
      }
    }
  }, [store, featuresStore, workflowStore])

  const syncWorkflowDraftWhenPageClose = useCallback(() => {
    if (getNodesReadOnly())
      return
    const postParams = getPostParams()

    if (postParams) {
      navigator.sendBeacon(
        `${API_PREFIX}/apps/${params.appId}/workflows/draft?_token=${localStorage.getItem('console_token')}`,
        JSON.stringify(postParams.params),
      )
    }
  }, [getPostParams, params.appId, getNodesReadOnly])

  /**
   * 异步保存工作流草稿
   * @param notRefreshWhenSyncError 保存出现错误情况下是否不刷新工作流草稿
   */
  const doSyncWorkflowDraft = useCallback(async (notRefreshWhenSyncError?: boolean) => {
    if (getNodesReadOnly())
      return
    // 获取发送post-draft请求的参数
    const postParams = getPostParams()

    if (postParams) {
      const {
        setSyncWorkflowDraftHash, // 设置同步工作流草稿的hash
        setDraftUpdatedAt, // 设置工作流草稿更新时间
      } = workflowStore.getState()
      try {
        const res = await syncWorkflowDraft(postParams)
        setSyncWorkflowDraftHash(res.hash)
        setDraftUpdatedAt(res.updated_at)
      }
      catch (error: any) {
        if (error && error.json && !error.bodyUsed) {
          error.json().then((err: any) => {
            if (err.code === 'draft_workflow_not_sync' && !notRefreshWhenSyncError)
              handleRefreshWorkflowDraft()
          })
        }
      }
    }
  }, [workflowStore, getPostParams, getNodesReadOnly, handleRefreshWorkflowDraft])

  /**
   * 触发工作流数据保存
   * @param sync 是否立即保存，否则利用 debounce 5秒之后保存
   * @param notRefreshWhenSyncError 保存出现错误情况下是否不刷新工作流草稿
   */
  const handleSyncWorkflowDraft = useCallback((sync?: boolean, notRefreshWhenSyncError?: boolean) => {
    if (getNodesReadOnly())
      return

    if (sync)
      doSyncWorkflowDraft(notRefreshWhenSyncError)
    else
      debouncedSyncWorkflowDraft(doSyncWorkflowDraft)
  }, [debouncedSyncWorkflowDraft, doSyncWorkflowDraft, getNodesReadOnly])

  return {
    doSyncWorkflowDraft,
    handleSyncWorkflowDraft,
    syncWorkflowDraftWhenPageClose,
  }
}
