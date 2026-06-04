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

import React, { Component } from "react";
import "./index.css";
import IconComponent from "../common/IconComponent";
import { Input,Collapse,Tooltip} from "antd";
import ChatGreetItemRender from "./ChatGreetItemRender";
import sha256 from "crypto-js/sha256";
import Base64 from "crypto-js/enc-base64";
import useStream from './useStream';
import ChatHistoryRecord from './ChatHistoryRecord';
import localforage from 'localforage';
import { cloneDeep } from "lodash";
import CommonModal from '../common/Modal';
import Toast from '../common/Toast';
import ChatItemsList from "./ChatItemsList";
import ChatSet from "./ChatSet";
const { TextArea } = Input;
const ONE_MEGA_BYTES = 1024 * 1024;

class Chat extends Component {
  constructor(props) {
    super(props);
    this.state = {
      modal: null,
      showToast: false,
      value: "",
      isActiveElement: false,
      showFailedAnswer: false,
      myIssueList: [], //用户提出的问题
      chatList: [],
      loading: false,
      loadingCompleted: false, // 流式数据是否全部加载完成
      reminder: "",
      openRecommendPopup: true,
      openQuestionPopup: false,
      isShowDownArrow: false,
      currentScrollTop: 0,
      canScrollBottom: true,
      apiKey:'',
      gptv:'claude-opus-4-7',
      context:'none',
      activeKey:['1'],
      enableStreaming:true,
      aiModelVendor:'Anthropic',
    };
    this.chatContentWrapperRef = null;
    this.exampleWrapperRef = null;
    this.textAreaRef=null;
  }

  async componentDidMount() {
    this.getIsShowDownArrow();
    const chatList = await localforage.getItem('chatList');
    if(chatList?.length > 0) {
      this.setState({
        chatList,
      }, () => {
        this.setNewSession();
      });
    }
  }

  componentWillUnmount() {
    // Drop the in-memory LLM API key as soon as this component is torn down.
    // Key is intentionally never persisted; this just narrows the live window.
    this.setState({ apiKey: '' });
  }

  componentDidUpdate(prevProps, prevState) {
    const { isExperience, exampleQuestionList } = this.props;
    const {gptv} = this.state;
    const { chatList,loading } = this.state;
    if (isExperience !== prevProps.isExperience) {
      this.handleState('reminder', "");
    }
    if (
      exampleQuestionList !== prevProps.exampleQuestionList &&
      chatList.length
    ) {
      this.getIsShowDownArrow();
    }
    if (!prevState.chatList.length && chatList.length) {
      this.getIsShowDownArrow();
    }
    if( gptv !== prevState.gptv ) {
      this.setNewSession();
    }
    if(chatList!=prevState.chatList){
      this.scrollToBottom();
    }
    if(this.props?.aiPanelvisible&&this.props?.aiPanelvisible!==prevProps?.aiPanelvisible&&!this.state.apiKey&&this.state.activeKey.length===0){
      this.setState({ activeKey: ['1'] })
    }
  }

  onSubmit = (value) => {
    const { isExperience } = this.props;
    const { chatList, loading, myIssueList, loadingCompleted ,apiKey} = this.state;
    if (loading || !value || loadingCompleted) return;
    this.textAreaRef.focus();
    let _chatList = [...chatList];
    let currentMyIssueInfo = {
      chatKey: _chatList.length + 1,
      type: "0",
      text: value,
    };
    this.setState(
      {
        chatList: [..._chatList, currentMyIssueInfo],
        myIssueList: [...myIssueList, currentMyIssueInfo],
        showFailedAnswer: false,
        canScrollBottom: true,
      },
      () => {
        if (!isExperience) {
          this.getChatGPTAnswer(value);
        } else {
          this.getCacheAnswer(value);
        }
        this.setState({
          value: "",
        });
        setTimeout(() => {
          let offset = document.getElementById("chat-wrapper-id")?.offsetTop;

          window.scrollTo({
            top: offset + 50,
            behavior: "smooth",
          });
        }, 300);
      }
    );
  };

  getCacheAnswer = async (value) => {
    const { hotContract, isExperience } = this.props;
    const {gptv}=this.state;
    const { chatList } = this.state;
    if (!hotContract) return;
    let item = {};
    const _sha256 = sha256(hotContract + "_" + value);
    const _base64 = Base64.stringify(_sha256);
    this.handleState('loading', true);
    // let res = await ApiClientTools.getChat(encodeURIComponent(_base64));
    this.handleState('loading', false);
    if (res && res.message === "SUCCESS") {
      item = {
        chatKey: chatList.length + 1,
        type: "1",
        text: res.answer,
        gptv,
        isExperience,
      };
    } else {
      let text = res?.message;
      if (text === "Don't find recommend answer.") {
        text = "This question hasn't been cached. Please select another contract, question, or language.";
      }
      item = {
        chatKey: chatList.length + 1,
        type: "1",
        text: text || "The system doesn't seem to have received your question. Please check the question you sent.",
        gptv,
        error: "1",
        isExperience,
      };
      this.setState({
        showFailedAnswer: true,
      });
    }
    this.setState(
      {
        chatList: [...chatList, item],
      },
      () => {
        this.storageChatList(this.state.chatList);
      }
    );
  };

  scrollToBottom = () => {
    if(!this.state.canScrollBottom) return;
    this.chatContentWrapperRef.scrollTop =
      this.chatContentWrapperRef.scrollHeight;
  };

  handleScrollEvent = (e) => {
    const {scrollTop, clientHeight, scrollHeight} = e.target;
    if(scrollTop + clientHeight === scrollHeight) {
      this.setState({
        currentScrollTop: scrollTop,
      })
    }
    if(this.state.scrollTop === 0) {
      this.setState({
        canScrollBottom: true,
      })
    } else {
      if(scrollTop >= this.state.currentScrollTop) {
        this.setState({
          canScrollBottom: true,
        })
      } else {
        this.setState({
          canScrollBottom: false,
        })
      }
    }
  };

  setStreamData = async (text, key, modal) => {
    const { isExperience } = this.props;
    // const {gptv}=this.state;
    const { chatList } = this.state;
    let _chatList = [...chatList];
   
    if(_chatList[key - 1]&&this.state.enableStreaming) {
      const preText = _chatList[key - 1].text;
      _chatList[key - 1].text = preText + text;
    } else {
      let item={
        chatKey: key,
        type: "1",
        text: text,
        gptv:modal,
        isExperience,
      }
      if(_chatList?.length&&_chatList[_chatList.length - 1]?.chatKey>key) {
        _chatList?.splice(-1, 0, item);
      }else{
        _chatList.push(item);
      }
    }
    this.setState(
      {
        chatList: _chatList,
      }
    );
  };

  handleOffline = (res) => {
    if (!res || res?.message === "Connection error.") {
      const { isExperience } = this.props;
      const { chatList,gptv } = this.state;
      this.setState(
      {
        chatList: [
          ...chatList,
          {
            chatKey: chatList.length + 1,
            type: "1",
            text: "Request timeout. Please check your network connection.",
            gptv,
            error: "1",
            isExperience,
          },
        ],
      });
      return true;
    }
    return false;
  };

  handleErrorMessage = (error) => {
    if (error) {
      const { chatList,gptv } = this.state;
      const { isExperience } = this.props;
      const { code, message ,type} = error;
      let text=code||type;
      let mes;
      if(text){
        mes= (typeof text !=='string'?text:
        (text?.charAt(0)?.toUpperCase() +
        text?.slice(1)?.replace(/_/g, " ")))+
        " : " + message;
      }else{
        mes=message;
      }
      if (mes) {
        this.setState(
          {
            chatList: [
              ...chatList,
              {
                chatKey: chatList.length + 1,
                type: "1",
                text: mes,
                gptv,
                error: "1",
                isExperience,
              },
            ],
          },
          () => {
            this.storageChatList(this.state.chatList);
          }
        );
      }
    }
  };

  getChatGPTAnswer = async (value) => {
    const { onSubmitQuestion, maxCodeLength,plugin } = this.props;
    const {apiKey, gptv, context} =this.state;
    let code = "";
    if(context==='currentFile'){
      try{
        const currentFileName = plugin?.config?.get('currentFile');
        code = await plugin?.app?.fileManager?.readFile(currentFileName)
      }catch(e){
        this.handleState('reminder',e?.message||"Read current file error");
        return;
      }
    }

    onSubmitQuestion && onSubmitQuestion();
    //this.handleState('reminder', "");
    if (!apiKey) {
      this.handleState('reminder',"Please click on 'TRON IDE AI ASSISTANT' above to open the configuration panel and set the API Key.");
      return;
    } else if(code&&code?.length > maxCodeLength) {
      this.handleState('reminder', "The source code length has reached the upper limit. Please select fewer contract files or shorten the source code.");
      return;
    } else {
      await this.handleState('reminder', "");
    }
    const { chatList } = this.state;
    let _userContent = code ? code + " " + value : value; 
  
    let _messages = this.getSessionMessages();
    _messages.push({
      role: 'user',
      content: _userContent,
    });
    const { fetchStreamData } = useStream({
      setLoading: (loading) => {
        this.handleState('loading', loading);
      },
      setLoadingCompleted: (loadingCompleted) => {
        this.setState({ loadingCompleted });
        this.storageChatList(this.state.chatList);
      },
      setError: this.handleErrorMessage,
      setStreamData: (text,modal) => {
        this.setStreamData(text, chatList.length + 1,modal);
      },
      handleOffline: this.handleOffline,
    });
    fetchStreamData({
      apiKey,
      userContent: _userContent,
      model: gptv,
      stream: this.state.enableStreaming,
      messages: _messages,
      aiModelVendor: this.state.aiModelVendor
    });
  };

  onTextAreaPressEnter = (e) => {
    const { value } = this.state;
    if (!e.shiftKey) {
      e.preventDefault();
      if(this.state.activeKey?.length) this.collapseHandle();
      this.onSubmit(value);
    }
    gtag("event", "click", {event_category: "ai_user_action",event_label: "ai_question"})
  };

  toReAnswer = () => {
    const { isExperience } = this.props;
    const { myIssueList } = this.state;
    const value = myIssueList[myIssueList.length - 1]?.text;
    this.setState({
      canScrollBottom: true,
    });
    if (!isExperience) {
      this.getChatGPTAnswer(value);
    } else {
      this.getCacheAnswer(value);
    }
  };

  fillValue = (value) => {
    this.textAreaRef.focus();
    this.setState({
      value,
    });
  };

  getIsShowDownArrow = () => {
    if (this.exampleWrapperRef) {
      const { isShowDownArrow } = this.state;
      const { clientHeight } = this.exampleWrapperRef;
      let isShow = clientHeight > 36;
      if (isShowDownArrow != isShow) {
        this.setState({
          isShowDownArrow: isShow,
        });
      }
    }
  };

  hideModal = () => {
    this.setState({
      modal: null
    });
  }

  handleClearChatListHistory = () => {
    this.setState({
      modal: (
      <CommonModal
        footer
        showCloseIcon={false}
        className="modal-dialog-new modal-dialog-contract-analysis-record-clear"
        onCancel={() => this.hideModal()}
        onOk={() => { 
          this.setState({
            chatList: [],
          });
          this.hideModal();
          this.storageChatList([]);
          gtag("event", "click", {event_category: "ai_user_action",event_label: "clear_records"})
        }}
        title=''
      >
        <div className='history-record-clear-content'>
          <div className="history-record-clear-icon">
            <IconComponent className='tron-icon tron-font-size-60px' icon="#icon-warning" />
          </div>
          <div className="history-record-clear-desc">
           Confirm to delete all chat records? Make sure you have saved all necessary data.
          </div>
        </div>
      </CommonModal>
      )
    });
  }

  storageChatList = async (chatList = []) => {
    const indexedDB = window.indexedDB ||
                      window.mozIndexedDB ||
                      window.webkitIndexedDB ||
                      window.msIndexedDB ||
                      window.shimIndexedDB;

    if(!indexedDB) {
      const chartListStr = JSON.stringify(chatList);
      let size = new Blob([chartListStr])?.size;
      if(size > 2 * ONE_MEGA_BYTES) {
        this.setState({
          showToast: true
        });
        setTimeout(() => {
          this.setState({
            showToast: false
          });
        }, 3000);
      }
      while(size > 2 * ONE_MEGA_BYTES) {
        chatList.shift();
        if(chatList?.[0]?.type === '1') {
          chatList.shift();
        }
        size = new Blob([JSON.stringify(chatList)])?.size;
      }
    }
    await localforage.setItem('chatList', chatList)?.catch(err => {
      if (err && err.name === 'QuotaExceededError') {
        console.log('localForage write failed: storage is full');
      }
    });
  }

  promisedSetState = (newState) => new Promise(resolve => this.setState(newState, resolve));

  handleState = async (state, value) => {
    //await this.promisedSetState({ [state]: value });
    this.setState({ [state]: value });
    const { chatList,gptv } = this.state;
    const _chatList = cloneDeep(chatList);
    const filterList = _chatList.filter(item => (!item[state]));
    if(value) {
      await this.promisedSetState({
        chatList: [...filterList, { gptv, [state]: value }]
      });
    } else {
      await this.promisedSetState({ chatList: [...filterList] });
    }
  };

  setNewSession = () => {
    const { intl } = this.props;
    const { chatList } = this.state;
    const _chatList = cloneDeep(chatList);
    if(_chatList.length > 0 && _chatList[_chatList.length - 1].newSession != 1) {
      _chatList.push({
        chatKey: _chatList.length + 1,
        type: "-1",
        text: "New Chat",
        newSession: "1",
      })
      this.setState({
        chatList: _chatList,
      })
    }
  };

  getSessionMessages = () => {
    const { chatList } = this.state;
    const _chatList = cloneDeep(chatList);
    let _messages = [];
    for(let i = _chatList.length - 1; i >= 0; i--) {
      if(_chatList[i].type == -1) break;
      if(_chatList[i].isExperience || _chatList[i].loading || _chatList[i].reminder) continue;
      _messages.push({
        role: _chatList[i].type == 0 ? 'user' : 'assistant', 
        content: _chatList[i].text,
      })
    }
    _messages.reverse();
    return _messages.slice(0, _messages.length - 1);
  };

  gptvHandle=(e)=>{
    this.setState({
      gptv:e
    })
  }

  apiKeyHandle=(e)=>{
    this.setState({
      apiKey:e
    })
  }

  contextHandle=(e)=>{
    this.setState({
      context:e
    })
  }

  collapseHandle=()=>{
    this.setState({ activeKey: [] })
  }

  enableStreamingHandle=(checked)=>{
    this.setState({ enableStreaming: checked });
  }

  onClose=()=>{
    const {plugin}=this.props;
    plugin&&plugin.call('aiPanel', 'hide');
    gtag("event", "click", {event_category: "ai_user_action",event_label: "hide_ai"})
  }

  getAiModelVendor=(vendor)=>{
    this.setState({ aiModelVendor: vendor })
  }

  render() {
    const {
      chatList,
      value,
      loading,
      isActiveElement,
      loadingCompleted,
      modal,
      showToast,
      gptv,
      activeKey,
      enableStreaming,
      apiKey,
    } = this.state;
    const {
      isExperience,
      codeLimit,
    } = this.props;
    
    return (
      <div className="chat-wapper" id="chat-wrapper-id">
        <div className="chat-content-outerlayer-wrapper">
          <div className="ai-topset-wrapper">
            <Collapse
              bordered={false}
              activeKey={activeKey}
              onChange={(keys) => {this.setState({ activeKey: keys });gtag("event", "click", {event_category: "ai_user_action",event_label: "toggle_ai_config"})}}
              items={[
                {
                  key: '1',
                  label: <span className="ai-title">TRON IDE AI Assistant</span>,
                  children: <ChatSet  enableStreaming={enableStreaming} enableStreamingHandle={this.enableStreamingHandle} collapseHandle={this.collapseHandle} gptvHandle={this.gptvHandle} apiKeyHandle={this.apiKeyHandle} contextHandle={this.contextHandle} getAiModelVendor={this.getAiModelVendor}/>,
                }
              ]}
            />
            {
              chatList.length ? <ChatHistoryRecord chatList={chatList} clearHistoryRecord={this.handleClearChatListHistory} /> : null
            }
            <span className="close-btn" onClick={this.onClose}>
              <Tooltip title={'Hide TRON IDE AI Assistant plugin'}
                align={{
                  offset: [-12, -10],
                  targetOffset: [0, 0],
                }}
              >
                <IconComponent className="tron-icon" icon="#icon-shouqi" />
              </Tooltip>
            </span>
          </div> 
          <div className="chat-content-out">
            <div
              className="chat-content-wrapper"
              ref={(ref) => {
                this.chatContentWrapperRef = ref;
              }}
              onScroll={this.handleScrollEvent}
            >
              {chatList.length ? (
                <ChatItemsList
                  list={chatList}
                  loadingCompleted={loadingCompleted}
                  toReAnswer={this.toReAnswer}
                  setNewSession={this.setNewSession}
                />
              ) : (
                <>
                  <ChatGreetItemRender gptv={gptv} />
                </>
              )}
            </div>
          </div>
        </div>
        <div className="chat-input-wrapper">
          <div
            className={`textarea-wrapper ${
              isExperience ? "textarea-disabled is-experience" : ""
            } ${isActiveElement ? "textarea-focus" : ""}`}
          >
            <div className="can-scroll">
              <TextArea
                ref={ref=>{this.textAreaRef=ref}}
                placeholder={isExperience
                  ? "Select an example question"
                  : "Enter any question you are interested in"}
                autoSize
                value={value}
                onChange={(e) => {
                  this.setState({ value: e?.target?.value.slice(0, codeLimit) })
                }}
                onPressEnter={this.onTextAreaPressEnter}
                disabled={isExperience}
                onFocus={() => {
                  this.setState({ isActiveElement: true });
                }}
                onBlur={() => {
                  this.setState({ isActiveElement: false });
                }}
              />
            </div>
            <div
              className={`submit-btn flex-center ${
                loading || loadingCompleted|| !value || isExperience? "disabled" : ""
              }`}
              onClick={() => {
                gtag("event", "click", {event_category: "ai_user_action",event_label: "ai_question"})
                if(this.state.activeKey?.length) this.collapseHandle();
                if(!isExperience) this.onSubmit(value);
              }}
            >
              <IconComponent className="tron-icon" icon="#icon-icon-fasong" />
            </div>
          </div>
        </div>
        {modal}
        {showToast && <Toast content={"Given the massive historical data volume, earliest chat records are deleted to retain the new ones."} />}
      </div>
    );
  }
}

export default Chat
