import type { BuiltinProviderConfig } from '../../store/types'

export const anthropicConfig: BuiltinProviderConfig = {
  id: 'anthropic',
  name: 'Anthropic',
  type: 'builtin',
  authType: 'token',
  apiEndpoint: 'https://api.anthropic.com',
  chatPath: '/v1/messages',
  headers: {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
    Accept: 'application/json',
  },
  enabled: true,
  description: 'Anthropic Claude API access for Claude 3.5 Sonnet, 3 Opus and other compatible models.',
  supportedModels: [
    'claude-3-5-sonnet-latest',
    'claude-3-5-haiku-latest',
    'claude-3-opus-latest',
    'claude-3-sonnet-20240229',
    'claude-3-haiku-20240307',
  ],
  modelMappings: {
    'claude-3-5-sonnet-latest': 'claude-3-5-sonnet-latest',
    'claude-3-5-haiku-latest': 'claude-3-5-haiku-latest',
    'claude-3-opus-latest': 'claude-3-opus-latest',
    'claude-3-sonnet-20240229': 'claude-3-sonnet-20240229',
    'claude-3-haiku-20240307': 'claude-3-haiku-20240307',
  },
  credentialFields: [
    {
      name: 'token',
      label: 'API Key',
      type: 'password',
      required: true,
      placeholder: 'sk-ant-...',
      helpText: 'Create an Anthropic API key in the Anthropic Console and paste it here.',
    },
  ],
}

export default anthropicConfig
