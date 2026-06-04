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

export interface TreeViewProps {
    children?: React.ReactNode,
    id?: string
}

export interface TreeViewItemProps {
    children?: React.ReactNode,
    id?: string,
    label: string | number | React.ReactNode,
    expand?: boolean,
    onClick?: (...args: any) => void,
    onInput?: (...args: any) => void,
    onMouseOver?: (...args) => void,
    onMouseOut?: (...args) => void,
    className?: string,
    iconX?: string,
    iconY?: string,
    icon?: string,
    labelClass?: string,
    controlBehaviour?: boolean
    innerRef?: any,
    onContextMenu?: (...args: any) => void,
    onBlur?: (...args: any) => void
}
