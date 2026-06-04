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

/**
  * Should be used to categorize different modules, main reason is to give users feedback if the modules
  * Produce exact results or have false positives and negatives in them
  * A further category could be approximate if some form of approximation is used
*/
export default {
  EXACT: { hasFalsePositives: false, hasFalseNegatives: false, id: 'EXACT' },
  HEURISTIC: { hasFalsePositives: true, hasFalseNegatives: true, id: 'HEURI' }
}
