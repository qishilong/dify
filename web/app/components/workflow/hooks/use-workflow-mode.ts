import { useMemo } from 'react'
import { useStore } from '../store'

/**
 * 获取当前flow模式
 * @returns {Object} 返回一个包含flow模式的对象。
 * @returns {boolean} normal - 是否为正常模式。!historyWorkflowData && !isRestoring
 * @returns {boolean} restoring - 是否为恢复模式。isRestoring
 * @returns {boolean} viewHistory - 是否为查看历史模式。!!historyWorkflowData
 */
export const useWorkflowMode = () => {
  const historyWorkflowData = useStore(s => s.historyWorkflowData)
  const isRestoring = useStore(s => s.isRestoring)
  return useMemo(() => {
    return {
      normal: !historyWorkflowData && !isRestoring,
      restoring: isRestoring,
      viewHistory: !!historyWorkflowData,
    }
  }, [historyWorkflowData, isRestoring])
}
