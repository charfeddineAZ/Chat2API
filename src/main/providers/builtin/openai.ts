import type { BuiltinProviderConfig } from '../../store/types'

export const openaiConfig: BuiltinProviderConfig = {
  id: 'openai',
  name: 'OpenAI',
  type: 'builtin',
  authType: 'token',
  apiEndpoint: 'https://api.openai.com',
  chatPath: '/v1/chat/completions',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
  enabled: true,
  description: 'OpenAI official API access for GPT-4o, GPT-4.1, o3 and other OpenAI-compatible models.',
  supportedModels: [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4.1',
    'gpt-4.1-mini',
    'gpt-4-turbo',
    'gpt-3.5-turbo',
    'o3-mini',
    'o1-mini',
  ],
  modelMappings: {
    'gpt-4o': 'gpt-4o',
    'gpt-4o-mini': 'gpt-4o-mini',
    'gpt-4.1': 'gpt-4.1',
    'gpt-4.1-mini': 'gpt-4.1-mini',
    'gpt-4-turbo': 'gpt-4-turbo',
    'gpt-3.5-turbo': 'gpt-3.5-turbo',
    'o3-mini': 'o3-mini',
    'o1-mini': 'o1-mini',
  },
  credentialFields: [
    {
      name: 'token',
      label: 'API Key',
      type: 'password',
      required: true,
      placeholder: 'sk-...',
      helpText: 'Create a key in OpenAI Platform and paste it here.',
    },
  ],
}

export default openaiConfig
