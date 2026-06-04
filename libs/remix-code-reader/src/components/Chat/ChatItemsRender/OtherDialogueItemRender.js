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

import React from 'react';
import classNames from "classnames";
import CodeHighlight from '../../common/CodeHighlight';
import {aiModelName} from '../../Chat/ChatSet';

const OtherDialogueItemRender = ({
  text,
  gptv,
  error,
  chatKey,
  toReAnswer,
  chatList,
  index,
  loadingCompleted,
}) => {
  const itemClass = classNames("other-dialogue-item", {
    "error-item": error === "1",
  });
  return (
    <div className={itemClass} key={chatKey}>
      <div
        className={`avatar flex-center`}
      >
        <img src="assets/img/aiAssistant.png"/>
      </div>
      <div className="dialogue-wrapper">
        {aiModelName[gptv]?<span>{aiModelName[gptv]}</span>:null}
        <div className="dialogue">
          <CodeHighlight isLastChat={index === chatList?.length - 1} text={text} index={index} loadingCompleted={loadingCompleted} />
          {error === "1" && chatKey === chatList?.length && (
            <span className="re-answer-wrapper">
              Then, you can
              <span onClick={toReAnswer} className="re-answer">
                try again.
              </span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export default OtherDialogueItemRender;