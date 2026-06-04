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
import IconComponent from "../../common/IconComponent";

class ChatGreetItemRender extends Component {
  constructor(props){
    super(props)
    this.state={
      carouselKey:'carouselKey',
    }
    this.t=null;
  }
  componentDidMount(){
    window.addEventListener('resize',this.windowResize) 
  }

  componentWillUnmount(){
    window.removeEventListener('resize',this.windowResize) 
  }

  windowResize=()=>{
    if(this.t) clearTimeout(this.t);
    this.t=setTimeout(()=>{
      this.setState({
        carouselKey:'carouselKey'+Date.now()
      })
    },100)
  }

  render() {
    return (
      <div className="other-dialogue-item chat-greet-item">
        <div className={`avatar flex-center`}>
          {/* <IconComponent className="tron-icon" icon="#icon-AI" /> */}
          <img src="assets/img/aiAssistant.png"/>
        </div>
        <div className="dialogue-wrapper">
          <div className="dialogue">
            <div>
              <span className="hi-there">Hi, there.</span>
              <span className="greet" role="img" aria-label="Greet">👋</span>
            </div>
            <div className="view"> I can help you solve contract issues.</div>
          </div>
        </div>
      </div>
    );
  }
}

export default ChatGreetItemRender
