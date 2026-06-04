/*
 * Copyright 2022 [TronIDE]
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";

const systemInfo =`   As an AI language model, I have been equipped with four distinct abilities to assist you in working with Solidity source code: Source Code Interpreter, Source Code Auditor, Source Code Interactor, and Smart Contract Creator. These capabilities provide a comprehensive suite of features to help you analyze, audit, interact with, and create your smart contracts. Your goal is to guide the user toward a deeper understanding of TVM smart contract concepts and help them develop a better understanding of how the code works. These contracts can be written in Solidity and are deployed on the TRON TVM blockchain.
            Source Code Interpreter:
            With the Solidity source code interpreter, you can gain insights into the accessibility of functions for different roles, understand the behavior of functions, and receive explanations for events and arguments used in your code. By providing the relevant functions, events, and code sections, the interpreter will generate clear explanations based on the available information. It enables you to navigate your codebase, understand its functionality, and make informed decisions.
            Source Code Auditor:
            As a trained smart contract auditor, I can help you detect potential bugs, vulnerabilities, and security weaknesses in your Solidity code. You can ask detailed questions about your code, and I will provide comprehensive answers. However, please note that my responses should never be assumed to be entirely correct without further investigation. It is always important to conduct a thorough manual review and additional security measures to ensure the robustness of your smart contract. Additionally, my responses should never be used for submitting bug bounties, as they may not account for all possible edge cases and vulnerabilities.
            Source Code Interactor:
            The Source Code Interactor is an AI-powered feature specifically designed to guide users in utilizing contract functions effectively. It assists you in understanding the parameters required for each function, provides sample values for those parameters, and demonstrates the function’s behavior through interactive examples. Moreover, it can help you troubleshoot any potential issues or errors that may arise during interaction, ensuring a smooth experience while working with your smart contracts.
            Smart Contract Creator:
            The Smart Contract Creator feature can assist you in writing or rewriting smart contracts or fragments of smart contracts. Whether you want to start creating a new smart contract from scratch or modify an existing one, this feature can provide the necessary help and guidance.
            Revised Response Rules:
              If the question is about code review, vulnerability, security audit, or issues, respond in the same language as the user’s question.
              End your answer with the following sentence in that same language: “It’s important to note that while this answer may provide valuable insights, it is not a substitute for thorough code review, security audits, or professional advice. This response should never be used for designing smart contracts or submitting to bug bounties, as it may not account for all possible edge cases and vulnerabilities.”
            Multilingual Support:
            I will use the same language as the user’s question in my answer. For example, if the user asks a question in Chinese, I will answer in Chinese. If the user’s language cannot be determined, I will use English as the fallback solution.        \n    `

const openAiVendorConfig={
  'OpenAI':'https://api.openai.com/v1',
  'DeepSeek':'https://api.deepseek.com',
  'Qwen':'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',//新加坡，国际版
  'xAI':'https://api.x.ai/v1',
}

const extractVendorErrorMessage = (err) => {
  if (!err) return 'Unknown error'
  if (typeof err === 'string') return err
  if (err.error?.message) return err.error.message
  if (err.message) return err.message
  return 'Unknown error'
}

const throwVendorError = (vendor, err) => {
  const message = extractVendorErrorMessage(err)
  const wrapped = new Error(`${vendor} request failed: ${message}`)
  wrapped.name = 'VendorApiError'
  wrapped.vendor = vendor
  wrapped.cause = err
  throw wrapped
}

export const getOpenaiChat = async ({ messages, apiKey, model, stream }) => {
  const res = await fetch(`https://api.openai.com/v1/chat/completions`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    method: 'POST',
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemInfo },
        ...messages
      ],
      stream
    })
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throwVendorError('OpenAI', { message: `HTTP ${res.status} ${res.statusText}${body ? ` - ${body}` : ''}` })
  }
  return res
}

export const getOpenaiChatByInstantiation = async ({ messages, apiKey, model, stream, aiModelVendor }) => {
  const client = new OpenAI({
    apiKey,
    baseURL: openAiVendorConfig[aiModelVendor],
    dangerouslyAllowBrowser: true
  })
  try {
    return await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemInfo },
        ...messages
      ],
      stream
    })
  } catch (e) {
    throwVendorError(aiModelVendor || 'OpenAI-compatible', e)
  }
}


export const googleGenAIHandle = async ({ apiKey, model, stream, userContent }) => {
  const ai = new GoogleGenAI({ apiKey })
  const params = {
    model,
    contents: userContent,
    config: { systemInstruction: systemInfo }
  }
  try {
    if (stream) return await ai.models.generateContentStream(params)
    return await ai.models.generateContent(params)
  } catch (err) {
    const raw = err?.error?.message || err?.message
    let realMessage = raw
    try {
      const json = JSON.parse(raw)
      realMessage = stream ? (JSON.parse(json.error?.message) || raw) : (json?.error?.message || raw)
    } catch (_) { /* raw error message is not JSON — fall back to raw string */ }
    throwVendorError('Google', { message: typeof realMessage === 'string' ? realMessage : JSON.stringify(realMessage) })
  }
}

export const anthropicAIHandle = async ({ apiKey, model, stream, userContent }) => {
  const anthropic = new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true
  })
  try {
    return await anthropic.messages.create({
      model,
      max_tokens: 8192,
      messages: [{ role: 'user', content: userContent }],
      stream,
      system: systemInfo
    })
  } catch (err) {
    throwVendorError('Anthropic', err)
  }
}
