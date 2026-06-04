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

import React from "react";
import { alpha } from "../../../utils";
import {Tooltip} from "antd";
// import {t,t2,tv} from "../../utils/i18n";
import cx from 'classnames';
import './index.scss';
// import isMobile from "@/utils/isMobile";
import IconComponent from "../IconComponent";


export class QuestionMark extends React.Component {

    constructor(props) {
        super(props);
        this.state = {
            open: false,
            id: alpha(24),
        };
    }

    render() {
      let {open, id } = this.state;
      let { text, placement, testSecond = '', className = '', info = '', wrapText = '', wrapVal = {},
        overlayStyle, tvText, tvValue, arrowPointAtCenter = false, offset = null, onOpenChange,
        dangerHtml = false, intl, addTipMoreClass = false, useLinkClass = false, wrapClassName = '',
        isTextLeft = false
      } = this.props;
      const formattedWrapText = wrapText && intl
        ? intl.formatMessage({ id: wrapText }, wrapVal)
        : "";
        return (
          <div className={`d-inline-block ${wrapClassName}`}>
            <Tooltip title={
              <div className={cx({
                'tooltip-learn-more': addTipMoreClass,
                'tooltip-link-wrap': useLinkClass,
                'tooltip-text-left': isTextLeft
              })}>
                {text?t(text):""}
                {testSecond? <span><br/> {t(testSecond)}</span> :""}
                {info?info:""}
                {wrapText ? dangerHtml ?
                  <span>{formattedWrapText}</span>
                  : t2(wrapText, wrapVal) : ""
                }
                {tvText ? tv(tvText, tvValue) : ""}
              </div>
            }
            align={{
              offset: offset ? offset : [0,-15],
            }}
            // open={true}
            trigger={ ['hover','click']}
            overlayStyle={overlayStyle}
            onOpenChange={onOpenChange}
            autoAdjustOverflow={true}
            arrow={true}
            placement={ placement } defaultOpen={ open } target={ id }
            overlayClassName={`${className} home-tooltip-overlay`}
            innerClassName="w-100">
              <div className="question-mark">
                <IconComponent className='tron-icon question-mark-icon' icon='#icon-icon-ask' />
              </div>
            </Tooltip>
          </div>
        )
    }
}
