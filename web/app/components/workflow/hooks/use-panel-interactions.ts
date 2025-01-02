import type { MouseEvent } from 'react'
import { useCallback } from 'react'
import { useWorkflowStore } from '../store'

export const usePanelInteractions = () => {
  const workflowStore = useWorkflowStore()

  /**
   * 处理面板背景菜单
   */
  const handlePaneContextMenu = useCallback((e: MouseEvent) => {
    e.preventDefault()
    const container = document.querySelector('#workflow-container')
    const { x, y } = container!.getBoundingClientRect()
    workflowStore.setState({
      panelMenu: {
        top: e.clientY - y,
        left: e.clientX - x,
      },
    })
  }, [workflowStore])

  /**
   * 处理取消面板背景菜单
   */
  const handlePaneContextmenuCancel = useCallback(() => {
    workflowStore.setState({
      panelMenu: undefined,
    })
  }, [workflowStore])

  /**
   * 处理取消节点背景菜单
   */
  const handleNodeContextmenuCancel = useCallback(() => {
    workflowStore.setState({
      nodeMenu: undefined,
    })
  }, [workflowStore])

  return {
    handlePaneContextMenu,
    handlePaneContextmenuCancel,
    handleNodeContextmenuCancel,
  }
}
