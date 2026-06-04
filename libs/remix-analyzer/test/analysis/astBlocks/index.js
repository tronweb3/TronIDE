/*
 * Original work Copyright © 2018-2021 Remix Team
 * Licensed under the Apache License, Version 2.0.
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

module.exports = {
  localCall: require('./localCall.json'),
  contractDefinition: require('./contractDefinition.json'),
  unaryOperation: require('./unaryOperation.json'),
  blockTimestamp: require('./blockTimestamp.json'),
  dynamicDeleteUnaryOp: require('./dynamicDeleteUnaryOp.json'),
  nowAst: require('./nowAst.json'),
  requireCall: require('./requireCall.json'),
  thisLocalCall: require('./thisLocalCall.json'),
  libCall: require('./libCall.json'),
  externalDirect: require('./externalDirect.json'),
  superLocal: require('./superLocal.json'),
  assignment: require('./assignment.json'),
  inlineAssembly: require('./inlineAssembly.json'),
  forLoopNode: require('./forLoopNode.json'),
  whileLoopNode: require('./whileLoopNode.json'),
  doWhileLoopNode: require('./doWhileLoopNode.json'),
  stateVariableContractNode: require('./stateVariableContractNode.json'),
  functionDefinition: require('./functionDefinition.json'),
  fullyQualifiedFunctionDefinition: require('./fullyQualifiedFunctionDefinition.json'),
  selfdestruct: require('./selfdestruct.json'),
  storageVariableNodes: require('./storageVariableNodes.json'),
  abiNamespaceCallNodes: require('./abiNamespaceCallNodes.json'),
  lowlevelCall: require('./lowlevelCall.json'),
  parameterFunction: require('./parameterFunction.json'),
  parameterFunctionCall: require('./parameterFunctionCall.json'),
  inheritance: require('./inheritance.json'),
  blockHashAccess: require('./blockHashAccess.json'),
  funcDefForComplexParams: require('./funcDefForComplexParams.json')
}
