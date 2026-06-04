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

import React, { useEffect, useState, useRef, memo } from 'react';
import { List } from 'antd';
import NewSessionItemRender from "../ChatItemsRender/NewSessionItemRender";
import MeDialogueItemRender from "../ChatItemsRender/MeDialogueItemRender";
import OtherDialogueItemRender from "../ChatItemsRender/OtherDialogueItemRender";
import LoadingDialogueItemRender from "../ChatItemsRender/LoadingDialogueItemRender";
import ChatSetReminderItemRender from "../ChatSetReminderItemRender";
import "./index.css";

const ChatItemsList = ({ list, loadingCompleted, toReAnswer = () => {}, setNewSession = () => {} }) => {

    const renderItems = (item, index) => {
      if(!item) return null;
      if(item.newSession) {
        return <NewSessionItemRender  {...item} />
      }
      if(item.loading) {
        return <LoadingDialogueItemRender  {...item} />
      }
      if(item.reminder) {
        return <ChatSetReminderItemRender
          {...item}
          toReAnswer={toReAnswer}
        />
      }
      return item.type === "1" ? (
        <OtherDialogueItemRender
            {...item}
            toReAnswer={toReAnswer}
            chatList={list}
            index={index}
            loadingCompleted={loadingCompleted}
            setNewSession={setNewSession}
        />
      ) : (
        <MeDialogueItemRender {...item} />
      );
    };
    
    return (
        <List
          itemLayout="horizontal"
          dataSource={list}
          renderItem={(item, index) => (
            <List.Item key={index}>
            {renderItems(item, index)}
            </List.Item>
          )}
        />
    );
};

export default memo(ChatItemsList);