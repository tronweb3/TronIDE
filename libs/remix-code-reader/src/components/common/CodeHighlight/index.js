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

import React, { memo, useEffect } from 'react';
import hljs from "highlight.js";
import MemoizedReactMarkdown from '../../Chat/MemoizedReactMarkdown';
// import ReactMarkdown from "react-markdown";
import hljsDefineSolidity from 'highlightjs-solidity';
import "highlight.js/styles/paraiso-light.css";
import './index.scss';

const CodeHighlight = ({ 
    text, index, loadingCompleted, isLastChat
}) => {

    useEffect(() => {
        if(isLastChat) {
            hljsDefineSolidity(hljs);
            hljs.highlightAll();
        }
    }, [isLastChat]);

    useEffect(() => {
        if(isLastChat && !loadingCompleted) {
            hljs.highlightAll();
        }
    }, [isLastChat, loadingCompleted]);

    return (
        <div id={`${index}-code-highlight-wrap`} className={`code-highlight-wrap ${index}-code-highlight-wrap`}>
            <MemoizedReactMarkdown children={text} />
        </div>
    );
}

export default CodeHighlight;