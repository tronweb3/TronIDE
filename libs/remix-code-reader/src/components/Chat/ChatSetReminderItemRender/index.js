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
// import { tu, tv } from "@/utils/i18n";

class ChatSetReminderItemRender extends Component {
  render() {
    const {reminder,toReAnswer}=this.props;
    return (
      <div className="other-dialogue-item chat-set-reminder-item">
        <div className={`avatar flex-center`}>
          {/* <IconComponent className="tron-icon" icon="#icon-AI" /> */}
          <img src="assets/img/aiAssistant.png"/>
        </div>
        <div className="dialogue-wrapper">
          <div className="dialogue">
            {/* <span className="finger" role="img" aria-label="Finger">👈</span> */}
            <span className="need-set-input-item">{reminder}</span>
            <span>{"Then, you can"}</span>
            <span className="re-submit" onClick={toReAnswer}>{"try again."}</span>
          </div>
        </div>
      </div>
    );
  }
}

export default ChatSetReminderItemRender
