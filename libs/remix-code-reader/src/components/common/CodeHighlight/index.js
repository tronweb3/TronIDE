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

import React, { memo, useEffect, useRef } from 'react';
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import MemoizedReactMarkdown from '../../Chat/MemoizedReactMarkdown';
// import ReactMarkdown from "react-markdown";
import hljsDefineSolidity from 'highlightjs-solidity';
import "highlight.js/styles/paraiso-light.css";
import './index.scss';

// The full highlight.js entrypoint registers every supported language and
// previously added ~1.5 MB of source to main.js. AI answers only need the
// common code-fence languages below; unknown labels still render safely as
// plain code through react-markdown.
hljsDefineSolidity(hljs);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('python', python);

const CodeHighlight = ({ 
    text, index, loadingCompleted, isLastChat
}) => {
    const containerRef = useRef(null);

    useEffect(() => {
        if (!isLastChat || !containerRef.current) return;
        // Highlight only this answer. highlightAll() walked every historical
        // chat message on each streaming update, making the cost grow with the
        // entire conversation.
        containerRef.current.querySelectorAll('pre code').forEach((block) => {
            delete block.dataset.highlighted;
            hljs.highlightElement(block);
        });
    }, [isLastChat, loadingCompleted, text]);

    return (
        <div ref={containerRef} id={`${index}-code-highlight-wrap`} className={`code-highlight-wrap ${index}-code-highlight-wrap`}>
            <MemoizedReactMarkdown children={text} />
        </div>
    );
}

export default memo(CodeHighlight);
