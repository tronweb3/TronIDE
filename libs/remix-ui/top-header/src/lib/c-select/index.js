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

import React, { useState } from "react";
import "./index.css";
import { Select } from "antd";
import classNames from "classnames";
import CIcon from "../c-icon";

const { Option } = Select;


//antd 3.x
const CSelect = ({ options=[],defaultValue,handleChange ,dropdownClass,selectClassName,...props}) => {
  const [dropdownVisible,setDropdownVisible]=useState(false);
  const onOpenChange=(e)=>{
    setDropdownVisible(e)
  }
  const _dropdownClassName=classNames('c-select-dropdown-class',{
    [dropdownClass]:!!dropdownClass,
  })

  const _selectClassName=classNames('c-select-class',{
    [selectClassName]:!!selectClassName,
  })

  return (
    <Select 
      defaultValue={defaultValue}
      suffixIcon={<CIcon 
        className={`dropdownIcon ${dropdownVisible?'rotate180':''}`} 
        icon={'#icon-down-arrow'} 
      />} 
      onOpenChange={onOpenChange} 
      onChange={handleChange}
      classNames={{ popup: { root: _dropdownClassName } }}
      className={_selectClassName}
      {...props}
    >
      {
        options?.map((item)=>{
          return <Option key={item?.value} value={item?.value}>{item?.text}</Option>
        })
      }
    </Select>
  );
};

export default CSelect;
