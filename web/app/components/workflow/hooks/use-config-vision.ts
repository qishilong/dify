import produce from 'immer'
import { useCallback } from 'react'
import { useIsChatMode } from './use-workflow'
import type { ModelConfig, VisionSetting } from '@/app/components/workflow/types'
import { useTextGenerationCurrentProviderAndModelAndModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import {
  ModelFeatureEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { Resolution } from '@/types/app'

type Payload = {
  enabled: boolean
  configs?: VisionSetting
}

type Params = {
  payload: Payload
  onChange: (payload: Payload) => void
}
const useConfigVision = (model: ModelConfig, {
  payload = {
    enabled: false,
  },
  onChange,
}: Params) => {
  // 获取当前模型
  const {
    currentModel: currModel,
  } = useTextGenerationCurrentProviderAndModelAndModelList(
    {
      provider: model.provider,
      model: model.name,
    },
  )

  const isChatMode = useIsChatMode()

  /**
   * 获取当前模型是否是视觉模型
   */
  const getIsVisionModel = useCallback(() => {
    return !!currModel?.features?.includes(ModelFeatureEnum.vision)
  }, [currModel])

  const isVisionModel = getIsVisionModel()

  /**
   * 处理视觉模型高分辨率分辨率是否启用
   */
  const handleVisionResolutionEnabledChange = useCallback((enabled: boolean) => {
    const newPayload = produce(payload, (draft) => {
      draft.enabled = enabled
      if (enabled && isChatMode) {
        draft.configs = {
          detail: Resolution.high,
          variable_selector: ['sys', 'files'],
        }
      }
    })
    onChange(newPayload)
  }, [isChatMode, onChange, payload])

  /**
   * 处理视觉模型分辨率设置（分辨率高低、变量选择器）
   */
  const handleVisionResolutionChange = useCallback((config: VisionSetting) => {
    const newPayload = produce(payload, (draft) => {
      draft.configs = config
    })
    onChange(newPayload)
  }, [onChange, payload])

  /**
   * 处理模型变更
   */
  const handleModelChanged = useCallback(() => {
    const isVisionModel = getIsVisionModel()
    if (!isVisionModel) {
      handleVisionResolutionEnabledChange(false)
      return
    }
    if (payload.enabled) {
      onChange({
        enabled: true,
        configs: {
          detail: Resolution.high,
          variable_selector: [],
        },
      })
    }
  }, [getIsVisionModel, handleVisionResolutionEnabledChange, onChange, payload.enabled])

  return {
    isVisionModel,
    handleVisionResolutionEnabledChange,
    handleVisionResolutionChange,
    handleModelChanged,
  }
}

export default useConfigVision
