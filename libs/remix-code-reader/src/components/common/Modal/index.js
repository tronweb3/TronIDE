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

/*
 * @Author: Jay Bian
 * @since: 2022-09-23 10:38:18
 * @message: 新UI规范下的公共modal组件
 */
import React from "react";
// import { injectIntl } from "react-intl";

import { Modal } from 'antd';
import IconComponent from "../IconComponent";

import "./index.css";

const CommonModal = (props) => {
  const {
    intl, wrapClassName = '', width = 500, title = null, footerFixed = false, footerTip = '', showCloseIcon = true,
    open = true, onCancel = () => { }, maskClosable = false, footer = null, loading = false, closeIconClass = '', contentLoading = false,
    children, onOk = () => { }, canSubmit = true, cancelText = '', cancelTextFunc, okText = '', centered = true, ...rest
  } = props;

  // loading 防连点
  const handleConfirm = () => {
    if (!canSubmit) return;
    if (loading) return;
    onOk();
  }

  return (
    <Modal
      width={width}
      open={open}
      title={title}
      onCancel={onCancel}
      closeIcon={showCloseIcon && <IconComponent className={`tron-icon tron-font-size-14px tron-font-default-color ${closeIconClass}`} icon='#icon-close-colorless' />}
      wrapClassName={`common-modal ${wrapClassName} ${footerFixed?'common-modal-footer-fixed':''}`}
      centered={centered}
      maskClosable={maskClosable}
      footer={null}
      {...rest}
    >
      {
        contentLoading ? (
          <div className="common-modal-loading-wrapper">
            <IconComponent className={'tron-icon tron-loading-icon'} icon={'#icon-icon-loding'} />
          </div>
        ) : (
          <div className="common-modal-content-wrapper">
            {children}
          </div>
        )
      }
      {
        footer
          ? (
            <>
            <div className="btns common-modal-footer-wrapper">
              <span
                onClick={cancelTextFunc || onCancel}
                className="cancel-btn"
              >
                {cancelText || 'cancel'}
              </span>
              <span
                onClick={handleConfirm}
                className={`confirm-btn ${!canSubmit ? 'disabled-btn' : ''}`}
              >
                {okText || 'ok' }
                {loading && <IconComponent className='tron-icon loading-icon tron-font-size-16px' icon="#icon-loading" />}
              </span>
            </div>
            {
              footerTip
            }
            </>
          )
          : null
      }
    </Modal>
  )
};

export default CommonModal
