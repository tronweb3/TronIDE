/*
 * Original work Copyright © 2018-2021 Remix Team
 * Licensed under the MIT License.
 *
 * Modifications Copyright © 2022 TronIDE
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

import React, { useState } from 'react'
import copy from 'copy-to-clipboard'
import { OverlayTrigger, Tooltip } from 'react-bootstrap'
import { Placement } from 'react-bootstrap/esm/Overlay'

import './copy-to-clipboard.css'

interface ICopyToClipboard {
  content: any,
  tip?: string,
  icon?: string,
  direction?: Placement,
  className?: string,
  title?: string,
  children?: JSX.Element
}
export const CopyToClipboard = (props: ICopyToClipboard) => {
  let { content, tip = 'Copy', icon = 'fa-copy', direction = 'right', children, ...otherProps } = props
  const [message, setMessage] = useState(tip)
  const handleClick = (e) => {
    if (content && content !== '') { // module `copy` keeps last copied thing in the memory, so don't show tooltip if nothing is copied, because nothing was added to memory
      try {
        if (typeof content !== 'string') {
          content = JSON.stringify(content, null, '\t')
        }
        copy(content)
        setMessage('Copied')
      } catch (e) {
        console.error(e)
      }
    } else {
      setMessage('Cannot copy empty content!')
    }
    e.preventDefault()
    return false
  }

  const reset = () => {
    setTimeout(() => setMessage('Copy'), 500)
  }

  return (
    // eslint-disable-next-line jsx-a11y/anchor-is-valid
    <a href='#' onClick={handleClick} onMouseLeave={reset}>
      <OverlayTrigger placement={direction} overlay={
        <Tooltip id="overlay-tooltip">
          { message }
        </Tooltip>
      }>
        {
          children || (<i className={`far ${icon} ml-1 p-2`} aria-hidden="true"
            {...otherProps}
          ></i>)
        }
      </OverlayTrigger>
    </a>
  )
}

export default CopyToClipboard
