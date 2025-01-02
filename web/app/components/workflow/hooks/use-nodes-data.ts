import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import produce from 'immer'
import { BlockEnum } from '../types'
import {
  NODES_EXTRA_DATA,
  NODES_INITIAL_DATA,
} from '../constants'
import { useIsChatMode } from './use-workflow'

/**
 * 初始化节点title数据
 * @returns
 */
export const useNodesInitialData = () => {
  const { t } = useTranslation()

  return useMemo(() => produce(NODES_INITIAL_DATA, (draft) => {
    Object.keys(draft).forEach((key) => {
      draft[key as BlockEnum].title = t(`workflow.blocks.${key}`)
    })
  }), [t])
}

/**
 * 获取节点额外数据
 * 节点描述，前一个可用节点，后一个可用节点
 * @returns
 */
export const useNodesExtraData = () => {
  const { t } = useTranslation()
  const isChatMode = useIsChatMode()

  return useMemo(() => produce(NODES_EXTRA_DATA, (draft) => {
    Object.keys(draft).forEach((key) => {
      draft[key as BlockEnum].about = t(`workflow.blocksAbout.${key}`)
      // 可用的前一个节点
      draft[key as BlockEnum].availablePrevNodes = draft[key as BlockEnum].getAvailablePrevNodes(isChatMode)
      // 可用的下一个节点
      draft[key as BlockEnum].availableNextNodes = draft[key as BlockEnum].getAvailableNextNodes(isChatMode)
    })
  }), [t, isChatMode])
}

/**
 * 获取前后可用的块（节点）
 * @param nodeType
 * @param isInIteration
 * @returns
 */
export const useAvailableBlocks = (nodeType?: BlockEnum, isInIteration?: boolean) => {
  const nodesExtraData = useNodesExtraData()
  const availablePrevBlocks = useMemo(() => {
    if (!nodeType)
      return []
    return nodesExtraData[nodeType].availablePrevNodes || []
  }, [nodeType, nodesExtraData])

  const availableNextBlocks = useMemo(() => {
    if (!nodeType)
      return []
    return nodesExtraData[nodeType].availableNextNodes || []
  }, [nodeType, nodesExtraData])

  return useMemo(() => {
    return {
      availablePrevBlocks: availablePrevBlocks.filter((nType) => {
        if (isInIteration && (nType === BlockEnum.Iteration || nType === BlockEnum.End))
          return false
        return true
      }),
      availableNextBlocks: availableNextBlocks.filter((nType) => {
        if (isInIteration && (nType === BlockEnum.Iteration || nType === BlockEnum.End))
          return false
        return true
      }),
    }
  }, [isInIteration, availablePrevBlocks, availableNextBlocks])
}
