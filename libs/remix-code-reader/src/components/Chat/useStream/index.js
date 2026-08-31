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

import { getOpenaiChatByInstantiation,googleGenAIHandle,anthropicAIHandle } from './../../../services/toolsApi';
import { OPENAI_COMPATIBLE_VENDORS } from './../../../services/aiToolProtocolAdapters';
import { AI_ENDPOINT_TYPE, BANK_OF_AI_VENDOR, sanitizeAIError } from './../../../services/aiProviderConfig';

const useStream = ({
  setLoading = () => {},
  setLoadingCompleted = () => {},
  setError = () => {},
  setStreamData = () => {},
  handleOffline = () => {},
}) => {
  const openSDKList = OPENAI_COMPATIBLE_VENDORS
  const fetchStreamData = async (params) => {
    const requestStartedAt = Date.now();
    let requestReported = false;
    const reportRequest = (status, error) => {
      if (requestReported) return;
      requestReported = true;
      if (typeof params?.onProviderRequest !== 'function') return;
      try { params.onProviderRequest({ status, durationMs: Math.max(0, Date.now() - requestStartedAt), ...(error ? { error } : {}) }); } catch (_) { /* metrics cannot break chat */ }
    };
    setLoading(true);
    setLoadingCompleted(true);

    try {
      let res;
      const vendor=params?.aiModelVendor;
      const _stream=params?.aiModelVendor=== 'DeepSeek'?false:params?.stream
      const usesAnthropicProtocol = vendor === 'Anthropic' || (vendor === BANK_OF_AI_VENDOR && params?.endpointType === AI_ENDPOINT_TYPE.ANTHROPIC)
      if(usesAnthropicProtocol){
        res = await anthropicAIHandle({
          ...params
        });
      }else if(openSDKList.includes(vendor)){
         res = await getOpenaiChatByInstantiation({
          ...params,
          stream:_stream
        });
      }else if(vendor==='Google'){
         res = await googleGenAIHandle({
          ...params
        });
      }
      setLoading(false);

      if (handleOffline && handleOffline(res)) {
        setLoadingCompleted(false);
        reportRequest('failed', new Error('offline'));
        return { status: 'failed' };
      }

      if (!res) {
        setLoadingCompleted(false);
        throw new Error("No response from server");
      }else if(res?.error?.message){
        if(typeof res?.error?.message === "string") {
          const safeError = sanitizeAIError(res.error);
          setError(safeError.message);
          reportRequest('failed', safeError);
        }
        setLoadingCompleted(false);
        if (typeof res?.error?.message !== "string") reportRequest('failed', sanitizeAIError(res?.error));
        return { status: 'failed' };
      }

      let assistantMessage = "";

      if(_stream){
        for await (const chunk of res) {
          if (params?.signal?.aborted) break;
          let content;
          if(usesAnthropicProtocol){
            content = chunk.delta?.text
          }else if(openSDKList.includes(vendor)){
            content = chunk.choices?.[0]?.delta?.content;
          }else if(vendor==='Google'){
            content = chunk.text
          }
          if (content) {
            assistantMessage += content;
            setStreamData(content,params?.model);
          }
        }
        // An Esc mid-stream keeps the partial text — mark it as interrupted so
        // the cut-off doesn't read like a finished (truncated-looking) answer.
        if (params?.signal?.aborted) {
          setStreamData((assistantMessage ? '\n\n' : '') + '⏹ Stopped.', params?.model);
        }
      }else{
        if(usesAnthropicProtocol){
          setStreamData(res?.content?.[0]?.text||'',params?.model);
        }else if(openSDKList.includes(vendor)){
          setStreamData(res?.choices?.[0]?.message?.content || '',params?.model);
        }else if(vendor==='Google'){
          setStreamData(res?.text||'',params?.model);
        }
      }

      setLoadingCompleted(false);
      reportRequest(params?.signal?.aborted ? 'cancelled' : 'succeeded');
      return { status: params?.signal?.aborted ? 'cancelled' : 'succeeded' };
    } catch (e) {
      setLoading(false);
      setLoadingCompleted(false);
      // Abort is a user action, not an error. SDKs vary on the name
      // (AbortError / APIUserAbortError), so also trust the signal. Still tell
      // the user it stopped — silence here looked like a hang that "fixed
      // itself" (the request may have died before the first chunk arrived).
      if (params?.signal?.aborted || /abort/i.test(e?.name || "") || e?.name === "AbortError") {
        setStreamData("⏹ Stopped.", params?.model);
        reportRequest('cancelled', e);
        return { status: 'cancelled' };
      }
      const safeError = sanitizeAIError(e);
      console.error("fetchStreamData error:", safeError);
      setError(safeError.message);
      reportRequest('failed', safeError);
      return { status: 'failed' };
    }
  };

  return {
    fetchStreamData
  };
};

export default useStream;
