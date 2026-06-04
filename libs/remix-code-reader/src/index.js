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

import React, {Component} from 'react';
import Chat from './components/Chat';
import './index.css';
import './fonts/iconfont.js'
import UsageIntroductionModal from './components/UsageIntroductionModal';

const defaultGPTV='gpt-4';
class CodeReader extends Component{
    constructor(props){
        super(props)
        this.state={
          modal:null,
          apiKey:'',
          gptv:defaultGPTV,
          hotContract:'',
          submitQuestionTimes:0,
          isExperience: false,
          isButtonDisabled:true,
          address: '',
          contractAddress: '',
          exampleQuestionList:[],
          maxCodeLength: 64000,
          codeLimit: 100000,
          usageIntroductionModal:null,
        }
    }

    componentDidMount(){
      this.getExampleQuestionList();
      this.usageIntroductionModalHandle();
    }

    componentDidUpdate(prevProps,prevState){
        const {address}=this.state;
        if(prevState.address!==address){
            this.getExampleQuestionList();
        }
    }

    usageIntroductionModalHandle=()=>{
      const usageIntroductionModalOpened=localStorage.getItem('usageIntroductionModalOpened')
      if(!usageIntroductionModalOpened){
        this.setState({
          usageIntroductionModal:<UsageIntroductionModal 
            onClose={()=>{
              this.setState({usageIntroductionModal:null});
            }} 
            onIUnderstand={()=>{
              localStorage.setItem('usageIntroductionModalOpened',true);
              this.setState({usageIntroductionModal:null});
            }}
          />
        })
      }
    }

  async getExampleQuestionList(passAddress='') {
    let address = this.state.address || passAddress;

    if (!address) {
      this.setState({
        exampleQuestionList: []
      })
      return
    };

    if(res){
      const { data } = res;
      if (data?.length > 0) {
        data.map((item, ind) => {
          item.key = ind;
        })
        this.setState({
          exampleQuestionList: data,
        })
      }

    }
  }

    setExperience = (type) => {
        this.setState({
          isExperience: type === '1',
        })

    }

    onSubmitQuestion=()=>{
        this.setState(({submitQuestionTimes})=>({submitQuestionTimes:submitQuestionTimes+1}))
    }

    render(){
      const { modal, code, gptv, apiKey, hotContract, isExperience, address, contractAddress, exampleQuestionList, maxCodeLength, codeLimit ,usageIntroductionModal}=this.state;
      const {plugin,aiPanelvisible}=this.props;
        return (
          <div className={'code-reader-wrapper'}>
              <div className='code-reader-content'>
                <div className='right-part-wrapper'>
                  <Chat plugin={plugin} aiPanelvisible={aiPanelvisible} exampleQuestionList={exampleQuestionList} address={address} isExperience={isExperience} apiKey={apiKey} gptv={gptv} code={code} hotContract={hotContract} contractAddress={contractAddress} onSubmitQuestion={this.onSubmitQuestion} maxCodeLength={maxCodeLength} codeLimit={codeLimit} />
                </div>
              </div>
            {modal}
            {usageIntroductionModal}
          </div>
        )
    }
}

export default CodeReader