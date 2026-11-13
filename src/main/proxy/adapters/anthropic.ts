import axios, { AxiosResponse } from 'axios'
import { PassThrough } from 'stream'
import type { Account, Provider } from '../../store/types'
import type { ChatCompletionRequest } from '../types'

function extractTextContent(content: any): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((part: any) => part && typeof part === 'object' && part.type === 'text')
      .map((part: any) => part.text || '')
      .join('')
  }
  return ''
}

function normalizeAnthropicMessages(messages: any[]): { role: 'user' | 'assistant' | 'system'; content: string }[] {
  const normalized: { role: 'user' | 'assistant' | 'system'; content: string }[] = []

  for (const message of messages) {
    const role = message.role === 'assistant' ? 'assistant' : message.role === 'system' ? 'system' : 'user'
    const text = extractTextContent(message.content)
    if (!text && message.content && Array.isArray(message.content)) {
      continue
    }
    normalized.push({ role, content: text })
  }

  return normalized
}

export class AnthropicAdapter {
  private provider: Provider
  private account: Account

  constructor(provider: Provider, account: Account) {
    this.provider = provider
    this.account = account
  }

  static isAnthropicProvider(provider: Provider): boolean {
    return provider.id === 'anthropic' || provider.apiEndpoint.includes('anthropic.com')
  }

  async chatCompletion(request: ChatCompletionRequest): Promise<{ response: AxiosResponse }> {
    const apiKey = this.account.credentials.token || this.account.credentials.apiKey || this.account.credentials.accessToken || ''
    if (!apiKey) {
      throw new Error('Anthropic API key not configured')
    }

    const systemMessages = request.messages.filter(message => message.role === 'system')
    const userMessages = request.messages.filter(message => message.role !== 'system')

    const body: Record<string, any> = {
      model: request.model,
      messages: normalizeAnthropicMessages(userMessages).map(message => ({
        role: message.role,
        content: message.content,
      })),
      max_tokens: request.max_tokens || 1024,
      temperature: request.temperature,
      stream: Boolean(request.stream),
    }

    if (systemMessages.length > 0) {
      body.system = systemMessages
        .map(message => extractTextContent(message.content))
        .filter(Boolean)
        .join('\n\n')
    }

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((tool: any) => ({
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters || { type: 'object', properties: {} },
      }))
    }

    if (request.tool_choice) {
      body.tool_choice = request.tool_choice
    }

    const response = await axios.post(`${this.provider.apiEndpoint.replace(/\/$/, '')}/v1/messages`, body, {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': this.provider.headers?.['anthropic-version'] || '2023-06-01',
        Accept: 'application/json',
      },
      timeout: 120000,
      validateStatus: () => true,
      responseType: request.stream ? 'stream' : 'json',
    })

    return { response }
  }
}

export class AnthropicStreamHandler {
  private model: string
  private created: number

  constructor(model: string) {
    this.model = model
    this.created = Math.floor(Date.now() / 1000)
  }

  async handleStream(stream: NodeJS.ReadableStream): Promise<NodeJS.ReadableStream> {
    const transform = new PassThrough()
    let buffer = ''

    const flush = () => {
      const frames = buffer.split(/\r?\n\r?\n/)
      buffer = frames.pop() || ''

      for (const frame of frames) {
        const lines = frame.split(/\r?\n/)
        const dataPayload = lines
          .filter(line => line.startsWith('data:'))
          .map(line => line.replace(/^data:\s*/, '').trim())
          .join('\n')

        if (!dataPayload) continue

        try {
          const payload = JSON.parse(dataPayload)
          if (payload.type === 'content_block_delta' && payload.delta?.type === 'text_delta') {
            const chunk = JSON.stringify({
              id: `chatcmpl-${Date.now().toString(36)}`,
              object: 'chat.completion.chunk',
              created: this.created,
              model: this.model,
              choices: [{ index: 0, delta: { content: payload.delta.text || '' }, finish_reason: null }],
            })
            transform.write(`data: ${chunk}\n\n`)
          }
          if (payload.type === 'message_delta' && payload.delta?.stop_reason) {
            const chunk = JSON.stringify({
              id: `chatcmpl-${Date.now().toString(36)}`,
              object: 'chat.completion.chunk',
              created: this.created,
              model: this.model,
              choices: [{ index: 0, delta: {}, finish_reason: payload.delta.stop_reason === 'end_turn' ? 'stop' : payload.delta.stop_reason }],
            })
            transform.write(`data: ${chunk}\n\n`)
          }
          if (payload.type === 'message_start') {
            const chunk = JSON.stringify({
              id: `chatcmpl-${Date.now().toString(36)}`,
              object: 'chat.completion.chunk',
              created: this.created,
              model: this.model,
              choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
            })
            transform.write(`data: ${chunk}\n\n`)
          }
        } catch (error) {
          console.warn('[AnthropicStreamHandler] Failed to parse SSE payload', error)
        }
      }
    }

    stream.on('data', (chunk: Buffer | string) => {
      buffer += chunk.toString()
      flush()
    })

    stream.on('end', () => {
      flush()
      transform.write('data: [DONE]\n\n')
      transform.end()
    })

    return transform
  }

  async handleNonStream(data: any): Promise<any> {
    const text = (data.content || [])
      .filter((block: any) => block.type === 'text')
      .map((block: any) => block.text || '')
      .join('')

    return {
      id: data.id || `chatcmpl-${Date.now().toString(36)}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: data.model || this.model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: text,
        },
        finish_reason: data.stop_reason || 'stop',
      }],
      usage: {
        prompt_tokens: data.usage?.input_tokens || 0,
        completion_tokens: data.usage?.output_tokens || 0,
        total_tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
      },
    }
  }
}
