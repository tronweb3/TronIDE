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
// import { injectIntl } from "react-intl";
import IconComponent from "../../common/IconComponent";
import dayjs from "dayjs";
// import { tv } from "@/utils/i18n";
// import localforage from 'localforage';
import { Dropdown, Menu } from 'antd';

class ChatHistoryRecord extends Component {
  constructor(props) {
    super(props);

    this.state = {
      isOpen: false
    }
  }

  componentDidMount() {

  }

  downChatHistoryRecord = async () => {
    const { intl, chatList } = this.props;
    let content = ``;
    const newSessionDividLine = '------------------------';
    chatList.forEach(item => {
      content += item.type ? (`${item.type === "1" ? `${item.gptv}: \n${item.text}\n\n\n` : 
                    item.newSession ? `${newSessionDividLine}${'New Chat'}${newSessionDividLine}\n\n` : 
                    `Me: \n${item.text}\n\n\n`}`) : '';
    });

    const blob = new Blob([content]);
    let evt = document.createEvent("HTMLEvents");
    evt.initEvent("click", true, true);
    const aLink = document.createElement('a');
    aLink.download = `TRONIDEAI_Assistant_History_${dayjs().format('YYYYMMDD')}.txt`;
    aLink.href = URL.createObjectURL(blob);
    aLink.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    gtag("event", "click", {event_category: "ai_user_action",event_label: "download_records"})
  }

  renderMenu = () => (
    <Menu className="chat-history-menu-wrapper" 
      data-testid='dropdown-menu'
      items={[{
        key: "down",
        label: <div onClick={this.downChatHistoryRecord}>{"Download chat history"}</div>
      }, {
        key: "clear",
        label: <div onClick={this.props.clearHistoryRecord}>{"Delete chat history"}</div>
      }]} />
  );

  handleOpenChange = (open) => {
    this.setState({
      isOpen: open, 
    });
  }

  render() {
    let { isOpen } = this.state;
    return (
      <div className="d-flex align-items-center chat-history-record-wrapper">
            <Dropdown dropdownRender={this.renderMenu} trigger={['hover']} onOpenChange={this.handleOpenChange}>
                <div data-testid='chat-history-oper-trigger' className="camera-icon">
                    <IconComponent className={`tron-icon tron-icon-camera ${isOpen && 'camera-icon-active'}`} icon='#icon-icon-more4' />
                </div>
            </Dropdown>
        </div>
    );
  }
}

export default ChatHistoryRecord
