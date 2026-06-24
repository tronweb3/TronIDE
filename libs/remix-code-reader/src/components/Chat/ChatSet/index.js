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

import React, { useState ,useRef} from 'react'
import './index.css'
import IconComponent from '../../common/IconComponent'
import { Input, Select ,Checkbox} from 'antd'

const contextOptionsData = [
  {
    value: 'none',
    title: 'None',
    description: 'Uses no context'
  },
  {
    value: 'currentFile',
    title: 'Current file',
    description: 'Uses the current file in the editor as context'
  },
  // {
  //   value: 'allOpenedFiles',
  //   title: 'All opened files',
  //   description: 'Uses all files opened in the editor as context'
  // },
  // {
  //   value: 'workspace',
  //   title: 'Workspace',
  //   description: 'Uses the current workspace as context'
  // }
]

const aiModelVendor={
  'Anthropic':{
    defaultValue:'claude-opus-4-8',
    findMyAPIKeyUrl:'https://console.anthropic.com/settings/keys',
    models:[{
      value:'claude-opus-4-8',
      label:'Claude Opus 4.8',
    },{
      value:'claude-opus-4-7',
      label:'Claude Opus 4.7',
    },{
      value:'claude-sonnet-4-6',
      label:'Claude Sonnet 4.6',
    },{
      value:'claude-sonnet-4-5',
      label:'Claude Sonnet 4.5',
    },{
      value:'claude-haiku-4-5-20251001',
      label:'Claude Haiku 4.5',
    }]
  },
  'OpenAI':{
    defaultValue:'gpt-5.5',
    findMyAPIKeyUrl:'https://help.openai.com/en/articles/4936850-where-do-i-find-my-secret-api-key',
    models:[{
      value:'gpt-5.5',
      label:'GPT-5.5',
    },{
      value:'gpt-5.4',
      label:'GPT-5.4',
    },{
      value:'gpt-5',
      label:'GPT-5',
    },{
      value:'gpt-5-mini',
      label:'GPT-5 mini',
    },{
      value:'gpt-4.1',
      label:'GPT-4.1',
    },{
      value:'o4-mini',
      label:'o4-mini',
    },{
      value:'gpt-4o',
      label:'GPT-4o',
    },{
      value:'gpt-4',
      label:'GPT-4',
    },{
      value:'gpt-3.5-turbo',
      label:'GPT-3.5',
    }]
  },
  'Google':{
    defaultValue:'',
    findMyAPIKeyUrl:'https://aistudio.google.com/app/api-keys',
    models:[{
      // TODO: confirm the real Gemini 3.0 Pro model id against Google GenAI docs once published
      value:'gemini-3.0-pro',
      label:'Gemini 3.0 Pro',
    },{
      value:'gemini-2.5-pro',
      label:'Gemini 2.5 Pro',
    },{
      value:'gemini-2.5-flash',
      label:'Gemini 2.5 Flash',
    },{
      value:'gemini-2.5-flash-lite',
      label:'Gemini 2.5 Flash Lite',
    },
    // {
    //   value:'gemini-2.0-flash',
    //   label:'Gemini 2.0 Flash',
    // }
  ]
  },
  'xAI':{
    defaultValue:'',
    findMyAPIKeyUrl:'https://console.x.ai',
    models:[{
      value:'grok-4',
      label:'Grok 4',
    },{
      value:'grok-4-fast-reasoning',
      label:'Grok 4 Fast',
    },{
      value:'grok-code-fast-1',
      label:'Grok Code Fast 1',
    }]
  },
  // 'DeepSeek':{
  //   defaultValue:'',
  //   findMyAPIKeyUrl:'https://platform.deepseek.com/api_keys',
  //   models:[{
  //     value:'deepseek-reasoner',
  //     label:'DeepSeek R1',
  //   },{
  //     value:'deepseek-chat',
  //     label:'DeepSeek V3',
  //   }]
  // },
  'Qwen':{
    defaultValue:'',
    findMyAPIKeyUrl:'https://www.alibabacloud.com/help/zh/model-studio/first-api-call-to-qwen#5058e161041ps',
    models:[{
      // TODO: confirm the real Qwen 3.7 model id against DashScope docs once published
      value:'qwen3.7',
      label:'Qwen 3.7',
    },{
      value:'qwen3-max',
      label:'Qwen3 Max',
    },{
      value:'qwen3-coder-plus',
      label:'Qwen3 Coder Plus',
    },{
      value:'qwen3-coder-flash',
      label:'Qwen3 Coder Flash',
    }]
  },
}

export const aiModelName={
  'gpt-5.5':'GPT-5.5',
  'gpt-5.4':'GPT-5.4',
  'gpt-5':'GPT-5',
  'gpt-5-mini':'GPT-5 mini',
  'gpt-4.1':'GPT-4.1',
  'o4-mini':'o4-mini',
  'gpt-4o':'GPT-4o',
  'gpt-4':'GPT-4',
  'gpt-3.5-turbo':'GPT-3.5',
  'claude-opus-4-8':'Claude Opus 4.8',
  'claude-opus-4-7':'Claude Opus 4.7',
  'claude-sonnet-4-6':'Claude Sonnet 4.6',
  'claude-sonnet-4-5':'Claude Sonnet 4.5',
  'claude-haiku-4-5-20251001':'Claude Haiku 4.5',
  'gemini-3.0-pro':'Gemini 3.0 Pro',
  'gemini-2.5-pro':'Gemini 2.5 Pro',
  'gemini-2.5-flash':'Gemini 2.5 Flash',
  'gemini-2.5-flash-lite':'Gemini 2.5 Flash Lite',
  // 'gemini-2.0-flash':'Gemini 2.0 Flash',
  'grok-4':'Grok 4',
  'grok-4-fast-reasoning':'Grok 4 Fast',
  'grok-code-fast-1':'Grok Code Fast 1',
  // 'deepseek-reasoner':'DeepSeek R1',
  // 'deepseek-chat':'DeepSeek V3',
  'qwen3.7':'Qwen 3.7',
  'qwen3-max':'Qwen3 Max',
  'qwen3-coder-plus':'Qwen3 Coder Plus',
  'qwen3-coder-flash':'Qwen3 Coder Flash',
}

export const apikeyRe= /^[a-zA-Z0-9-_]{35,164}$/;

const contextOptions = contextOptionsData.map((o) => ({
  value: o.value,
  label: (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontWeight: 600 }}>{o.title}</div>
      <div style={{ fontSize: 12, color: '#888' }}>{o.description}</div>
    </div>
  )
}))

const ChatSet = ({ gptvHandle, apiKeyHandle,contextHandle,collapseHandle,enableStreamingHandle,enableStreaming ,getAiModelVendor}) => {
  const [openEye, setOpenEye] = useState(false)
  const [context, setContext] = useState('none')
  const [modelVendor, setModelVendor] = useState('Anthropic')
  const [modelVersion, setModelVersion] = useState(aiModelVendor[modelVendor]?.defaultValue||aiModelVendor[modelVendor]?.models[0]?.value)
  const [apiKey, setApiKey] = useState('')
  const timerRef = useRef();
  const [keyTip, setKeyTip] = useState(false);

  const onOpenAPIkeyChange = (e) => {
    const v=e.target.value
    apiKeyHandle && apiKeyHandle(v)
    setApiKey(v)
    if(!(apikeyRe?.test(v?.trim()))){
      setKeyTip(true);
    }else{
      setKeyTip(false);
    }
    if(v){
       if (timerRef.current) {
          clearTimeout(timerRef.current);
        }
        timerRef.current = window.setTimeout(() => {
          gtag("event", "set_key", {event_category: "ai_user_action",event_label: "set_key"})
        }, 800);
    }
  }

  const onSelectChange = (e) => {
    gptvHandle && gptvHandle(e)
    setModelVersion(e)
    gtag("event", "click", {event_category: "ai_user_action",event_label: `select_model_${e}`})
  }

  const onSelectVendorChange = (e) => {
    setModelVendor(e)
    onSelectChange(aiModelVendor[e]?.defaultValue||aiModelVendor[e]?.models[0]?.value)
    getAiModelVendor&&getAiModelVendor(e)
    apiKeyHandle && apiKeyHandle('')
    setKeyTip(false);
    setApiKey('')
    gtag("event", "ai_vendor", {event_category: "ai_user_action",event_label: `select_vendor_${e}`})
  }

  const onContextChange = (e) => {
    setContext(e)
    contextHandle&& contextHandle(e)
  }

  const onCollapseHandle=()=>{
    collapseHandle&& collapseHandle()
    gtag("event", "click", {event_category: "ai_user_action",event_label: "collapse_ai_config"})
  }

  const onChangeGPTCheckbox=(e)=>{
    enableStreamingHandle&& enableStreamingHandle(e.target.checked)
  }

  return (
    <div className="chat-set-wrapper">
      <div className='chat-set-content'>
        <div className="explanation-list">
          <div className='top-info'>
            <img src="assets/img/aiAssistant.png"/>
            <h4>TRON IDE AI</h4>
            <p>TRON IDE AI supports contextual questioning and provides real-time answers to your contract development issues, helping you quickly build and optimize TRON smart contracts.</p>
          </div>
          <div className="item">
            <IconComponent className="tron-icon" icon={'#icon-icon-v1'} />
            <span>Any open source contract</span>
          </div>
          <div className="item">
            <IconComponent className="tron-icon" icon={'#icon-icon-v1'} />
            <span>Any question</span>
          </div>
          <div className="item">
            <IconComponent className="tron-icon" icon={'#icon-icon-v1'} />
            <span>Wide spectrum of AI models</span>
          </div>
        </div>
        <div className="ai-model-vendor-wrap">
          <div className="open-ai-title">Select an AI model vendor</div>
          <Select
            defaultValue={modelVendor}
            placeholder={'Select an AI model vendor'}
            suffixIcon={<IconComponent className="tron-icon" icon={'#icon-down-arrow'} />}
            onChange={onSelectVendorChange}
            options={Object.keys(aiModelVendor).map((item)=>({
              value: item, label: item
            }))}
          ></Select>
        </div>
        <div>
          <div className="open-ai-title">
            <span className="keySelect-title">Enter your API Key</span>
            <a className="fz12" href={aiModelVendor[modelVendor]?.findMyAPIKeyUrl} target="_blank" rel="noopener noreferrer">
              Where to find my API Key?
            </a>
          </div>
          <Input
            type={openEye ? 'text' : 'password'}
            value={apiKey}
            onChange={onOpenAPIkeyChange}
            placeholder={'Paste your API Key here'}
            maxLength={200}
            autoComplete="off"
            spellCheck={false}
            data-lpignore="true"
            data-1p-ignore="true"
            data-form-type="other"
            // status={keyTip?'error':''}
            suffix={
              <div className="eye flex-center">
                <IconComponent
                  className="tron-icon"
                  icon={openEye ? '#icon-password-see-copy' : '#icon-password-nosee-copy'}
                  onClick={(e) => {
                    e.stopPropagation()
                    setOpenEye(!openEye)
                  }}
                />
              </div>
            }
          />
          {
            keyTip?<div className='key-tip'>Your API key does not meet the requirements</div>:null
          }
          <div className='key-security-notice'>
            ⚠ Your API key is kept only in browser memory — never saved to disk and cleared when you close this panel or reload. Prefer a dedicated key with a low spend limit, and do not paste production keys. If you install an untrusted plugin while this key is set, revoke it immediately at the provider console.
          </div>
        </div>
        <div className="gpt-model-wrap">
          <div className="open-ai-title">Select an AI model</div>
          <Select
            value={modelVersion}
            placeholder={'Select an AI model'}
            suffixIcon={<IconComponent className="tron-icon" icon={'#icon-down-arrow'} />}
            onChange={onSelectChange}
            options={aiModelVendor[modelVendor]?.models}
          ></Select>
          {
            modelVendor==='DeepSeek'?null:<p><Checkbox onChange={onChangeGPTCheckbox} defaultChecked={enableStreaming}>Enable streaming response (generate replies in real time)</Checkbox></p>
          }
          {/* <p>Please ensure this API Key has access to {modelVersion||'GPT-4'} Model.</p> */}
        </div>

        <div className="context-wrap">
          <div className="open-ai-title">Context</div>
          <Select
            value={context}
            optionLabelProp="value"
            placeholder={'Context'}
            suffixIcon={<IconComponent className="tron-icon" icon={'#icon-down-arrow'} />}
            onChange={onContextChange}
            options={contextOptions}
          ></Select>
        </div>
      </div>

      <div className="collapse-wrap">
        <span onClick={onCollapseHandle}>Collapse <IconComponent className="tron-icon" icon={'#icon-down-arrow'} /></span>
      </div>
    </div>
  )
}

export default ChatSet
