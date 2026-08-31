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

import React, { useEffect, useState, useReducer, useMemo, useRef } from 'react'
import Button from './Button/StaticAnalyserButton' // eslint-disable-line
import * as remixLib from '@remix-project/remix-lib'
import _ from 'lodash'
import { TreeView, TreeViewItem } from '@remix-ui/tree-view' // eslint-disable-line
import { RemixUiCheckbox } from '@remix-ui/checkbox' // eslint-disable-line
import ErrorRenderer from './ErrorRenderer' // eslint-disable-line
import { compilation } from './actions/staticAnalysisActions'
import { initialState, analysisReducer } from './reducers/staticAnalysisReducer'
import { OverlayTrigger, Tooltip } from 'react-bootstrap'// eslint-disable-line
const StaticAnalysisRunner = require('@remix-project/remix-analyzer').CodeAnalysis
const utils = remixLib.util

/* eslint-disable-next-line */
export interface RemixUiStaticAnalyserProps {
  registry: any,
  event: any,
  analysisModule: any
}

const getCompilerArtefactsApi = (registry: any) => {
  if (!registry || typeof registry.get !== 'function') return null
  for (const name of ['compilersartefacts', 'compilerArtefacts']) {
    try {
      const entry = registry.get(name)
      const api = entry && entry.api ? entry.api : entry
      if (api && typeof api.get === 'function') return api
    } catch (e) {
      // Try the alternate registry key when a provider is not registered yet.
    }
  }
  return null
}

// The MISC ("Miscellaneous") category is advisory: Guard conditions (a generic
// assert/require reminder that fires on correct code too), similar-variable-name
// hints and view/pure suggestions. These are style/education, not defects — they
// are shown but EXCLUDED from the left-icon badge count so the badge reflects
// issues worth acting on (Security/Gas/ERC/TRON/Slither).
const ADVISORY_CATEGORY_IDS = ['MISC']
const SUMMARY_ORDER = [
  { id: 'SEC', label: 'Security', cls: 'badge-danger' },
  { id: 'GAS', label: 'Gas', cls: 'badge-warning' },
  { id: 'ERC', label: 'ERC', cls: 'badge-info' },
  { id: 'TRON', label: 'TRON', cls: 'badge-info' },
  { id: 'SLITHER', label: 'Slither', cls: 'badge-secondary' },
  { id: 'MISC', label: 'Advisory', cls: 'badge-light' }
]

export const RemixUiStaticAnalyser = (props: RemixUiStaticAnalyserProps) => {
  const [runner] = useState(() => new StaticAnalysisRunner())

  const preProcessModules = (arr: any) => {
    return arr.map((Item, i) => {
      const itemObj = new Item()
      itemObj._index = i
      itemObj.categoryDisplayName = itemObj.category.displayName
      itemObj.categoryId = itemObj.category.id
      return itemObj
    })
  }

  const getIndex = (modules, array) => {
    Object.values(modules).map((value: {_index}) => {
      if (Array.isArray(value)) {
        value.forEach((x) => {
          array.push(x._index.toString())
        })
      } else {
        array.push(value._index.toString())
      }
    })
  }

  const groupedModuleIndex = (modules) => {
    const indexOfCategory = []
    if (!_.isEmpty(modules)) {
      getIndex(modules, indexOfCategory)
    }
    return indexOfCategory
  }

  // Module instances are immutable metadata. Keep them stable across warning
  // and summary state updates instead of rebuilding every analyzer on render.
  const groupedModules = useMemo(() => utils.groupBy(preProcessModules(runner.modules()), 'categoryId'), [runner])
  const [autoRun, setAutoRun] = useState(true)
  const [slitherEnabled, setSlitherEnabled] = useState(false)
  const [showSlither, setShowSlither] = useState(false)
  const [categoryIndex, setCategoryIndex] = useState(() => groupedModuleIndex(groupedModules))

  const warningContainer = React.useRef(null)
  const mounted = React.useRef(true)
  const runGeneration = React.useRef(0)
  const [warningState, setWarningState] = useState({})
  const [collapsedGroups, setCollapsedGroups] = useState({})
  const [state, dispatch] = useReducer(analysisReducer, initialState)
  const [currentFile, setCurrentFile] = useState('')
  // Analysis runs over the FULL compiled source, so imported libraries
  // (OpenZeppelin etc.) flood the panel with findings the user didn't write.
  // Default to hiding those and show only the user's own files; a toggle brings
  // them back.
  const [hideLibraryWarnings, setHideLibraryWarnings] = useState(true)
  const [hiddenLibraryCount, setHiddenLibraryCount] = useState(0)
  // Findings counted by category (categoryId -> count) for the summary bar, so
  // the user can see at a glance that most of a big number is low-value
  // advisory noise (Guard conditions, similar names) rather than real issues.
  const [categorySummary, setCategorySummary] = useState({})
  const findingsRef = useRef<any[] | null>(null)
  const hideLibraryWarningsRef = useRef(hideLibraryWarnings)
  hideLibraryWarningsRef.current = hideLibraryWarnings

  useEffect(() => {
    return () => {
      mounted.current = false
      // Invalidate all compiler/Slither callbacks that are still pending.
      runGeneration.current += 1
    }
  }, [])

  useEffect(() => {
    const disposeCompilation = compilation(props.analysisModule, dispatch)
    return () => {
      if (disposeCompilation) disposeCompilation()
    }
  }, [props.analysisModule])

  // A finding's source file is an external dependency (not the user's code).
  // Matches only unambiguous dependency markers so it never hides a user's own
  // file: a bare-package specifier ('@openzeppelin/…'), a vendored path
  // ('.deps/', 'node_modules/', 'installed_contracts/'), or a remote-import URL
  // scheme (github/https/ipfs/swarm — how github/npm imports get keyed).
  const isLibraryFile = (fileName) => {
    if (!fileName) return false
    const f = String(fileName)
    return f.startsWith('@') ||
      /(^|\/)(\.deps|node_modules|installed_contracts)\//.test(f) ||
      /^(https?|github|ipfs|swarm|bzz-raw):/i.test(f)
  }

  // Re-filter the raw findings when the toggle flips. Do not rerun the AST and
  // Slither analyzers just to change presentation.
  useEffect(() => {
    if (findingsRef.current) renderFindings(findingsRef.current)
  }, [hideLibraryWarnings]) // eslint-disable-line

  useEffect(() => {
    let active = true
    const reset = () => { setCurrentFile('') }
    const setCurrent = (file) => { setCurrentFile(file) }
    props.analysisModule.on('fileManager', 'currentFileChanged', setCurrent)
    props.analysisModule.on('fileManager', 'noFileSelected', reset)
    // Initialise with the file that is already open when the panel mounts
    props.analysisModule.call('fileManager', 'getCurrentFile').then((file) => {
      if (active) setCurrentFile(file)
    }).catch(() => { if (active) setCurrentFile('') })
    return () => {
      active = false
      props.analysisModule.off('fileManager', 'currentFileChanged')
      props.analysisModule.off('fileManager', 'noFileSelected')
    }
  }, [props.analysisModule])

  useEffect(() => {
    let active = true
    const loadLastCompilation = async () => {
      let artefact = null
      const compilerArtefacts = getCompilerArtefactsApi(props.registry)
      try {
        // The panel may be opened after compilation. Recover the last
        // compilation instead of forcing the user to compile again merely to
        // populate the analyzer's local reducer state.
        artefact = await props.analysisModule.call('compilerArtefacts', 'get', '__last')
      } catch (e) {}
      if (!artefact || typeof artefact.getData !== 'function') {
        try { artefact = compilerArtefacts && compilerArtefacts.get('__last') } catch (ignored) {}
      }
      if (!active || !artefact || typeof artefact.getData !== 'function') return
      const source = typeof artefact.getSourceCode === 'function' ? artefact.getSourceCode() : null
      const file = source && source.target
      const data = artefact.getData()
      if (!file || !source || !data) return
      dispatch({
        type: 'compilationFinished',
        payload: { file, source, languageVersion: artefact.languageversion, data }
      })
    }
    loadLastCompilation()
    return () => { active = false }
  }, [props.analysisModule, props.registry])

  useEffect(() => {
    setWarningState({})
    setCategorySummary({})
    if (autoRun) {
      if (state.data !== null) {
        run(state.data, state.source, state.file)
      }
    } else {
      findingsRef.current = null
      props.event.trigger('staticAnaysisWarning', [])
    }
    return undefined
  }, [state])

  useEffect(() => {
    const onSetWorkspace = (currentWorkspace) => {
      // Reset warning state
      setWarningState([])
      setCategorySummary({})
      // Reset badge
      props.event.trigger('staticAnaysisWarning', [])
      // Reset state
      dispatch({ type: 'reset' })
      // Show 'Enable Slither Analysis' checkbox
      if (currentWorkspace && currentWorkspace.isLocalhost === true) setShowSlither(true)
      else {
        setShowSlither(false)
        setSlitherEnabled(false)
      }
    }
    const onPluginDeactivated = (plugin) => {
      // Hide 'Enable Slither Analysis' checkbox
      if (plugin.name === 'remixd') {
        // Reset warning state
        setWarningState([])
        setCategorySummary({})
        // Reset badge
        props.event.trigger('staticAnaysisWarning', [])
        // Reset state
        dispatch({ type: 'reset' })
        setShowSlither(false)
        setSlitherEnabled(false)
      }
    }
    props.analysisModule.on('filePanel', 'setWorkspace', onSetWorkspace)
    props.analysisModule.on('manager', 'pluginDeactivated', onPluginDeactivated)
    return () => {
      props.analysisModule.off('filePanel', 'setWorkspace')
      props.analysisModule.off('manager', 'pluginDeactivated')
    }
  }, [props.analysisModule, props.event])

  const message = (name, warning, more, fileName, locationString) : string => {
    return (`
    <span className='d-flex flex-column'>
    <span className='h6 font-weight-bold'>${name}</span>
    ${warning}
    ${more
      ? (<span><a href={more} target='_blank' rel='noopener noreferrer'>more</a></span>)
      : (<span> </span>)
    }
    <span className="" title={Position in ${fileName}}>Pos: ${locationString}</span>
    </span>`
    )
  }

  const showWarnings = (warningMessage, groupByKey) => {
    const resultArray = []
    warningMessage.map(x => {
      resultArray.push(x)
    })
    function groupBy (objectArray, property) {
      return objectArray.reduce((acc, obj) => {
        const key = obj[property]
        if (!acc[key]) {
          acc[key] = []
        }
        // Add object to list for given key's value
        acc[key].push(obj)
        return acc
      }, {})
    }

    const groupedCategory = groupBy(resultArray, groupByKey)
    setWarningState(groupedCategory)
    // advisory groups (style/naming reminders) can easily outnumber the
    // meaningful findings 10:1 — start them collapsed so Security/Gas stay
    // above the fold; a click on the group header expands them
    const initialCollapsed = {}
    Object.entries(groupedCategory).forEach(([groupName, items]) => {
      const categoryId = (items[0] && (items[0] as any).warningCategoryId) || 'MISC'
      if (ADVISORY_CATEGORY_IDS.includes(categoryId)) initialCollapsed[groupName] = true
    })
    // defaults only seed groups the user has NOT toggled: autorun re-analyzes
    // on every compile, and rebuilding the state from scratch snapped a
    // manually expanded advisory group shut on each recompile
    setCollapsedGroups(prev => ({ ...initialCollapsed, ...prev }))
  }

  const renderFindings = (findings) => {
    let hiddenCount = 0
    const visibleFindings = findings.filter((finding) => {
      const fileName = finding.options && finding.options.fileName
      if (hideLibraryWarningsRef.current && isLibraryFile(fileName)) {
        hiddenCount++
        return false
      }
      return true
    })
    setHiddenLibraryCount(hiddenCount)
    showWarnings(visibleFindings, 'warningModuleName')
    const byCat = {}
    visibleFindings.forEach((finding) => {
      const category = finding.warningCategoryId || 'MISC'
      byCat[category] = (byCat[category] || 0) + 1
    })
    setCategorySummary(byCat)
    const meaningful = visibleFindings.filter((finding) => !ADVISORY_CATEGORY_IDS.includes(finding.warningCategoryId || 'MISC')).length
    props.event.trigger('staticAnaysisWarning', [meaningful])
  }

  const run = (lastCompilationResult, lastCompilationSource, compiledFile) => {
    const runId = ++runGeneration.current
    const isCurrentRun = () => mounted.current && runGeneration.current === runId
    if (state.data !== null) {
      if (lastCompilationResult && (categoryIndex.length > 0 || slitherEnabled)) {
        const warningMessage = []
        findingsRef.current = null

        // The last compilation result/source/file (state.*) only describe the
        // file they were produced from. If the user switched to another contract
        // that has not been recompiled, that AST is stale for the active file and
        // must not be used: skip the AST-based Remix modules, and run Slither
        // against the file currently open in the editor instead of the stale one.
        const astValidForCurrentFile = !!compiledFile && compiledFile === currentFile
        const remixCategories = astValidForCurrentFile ? categoryIndex : []
        const slitherTargetFile = astValidForCurrentFile ? compiledFile : currentFile

        // Remix Analysis
        const finalize = () => {
          if (!isCurrentRun()) return
          findingsRef.current = warningMessage.slice()
          renderFindings(findingsRef.current)
        }

        runner.run(lastCompilationResult, remixCategories, results => {
          if (!isCurrentRun()) return
          results.map((result) => {
            let moduleName
            let moduleCategoryId
            Object.keys(groupedModules).map(key => {
              groupedModules[key].forEach(el => {
                if (el.name === result.name) {
                  moduleName = groupedModules[key][0].categoryDisplayName
                  moduleCategoryId = key
                }
              })
            })
            if (result.error) {
              const errorModuleName = moduleName || result.name
              const errorMessage = message(errorModuleName, `Static analysis failed: ${result.error}`, null, compiledFile || '', 'not available')
              warningMessage.push({
                msg: errorMessage,
                options: {
                  type: 'warning',
                  useSpan: true,
                  errFile: compiledFile,
                  fileName: compiledFile,
                  errLine: 0,
                  errCol: 0,
                  item: { warning: result.error },
                  name: result.name,
                  locationString: 'not available'
                },
                hasWarning: true,
                warningModuleName: errorModuleName,
                warningCategoryId: moduleCategoryId || 'MISC'
              })
            }
            ;(result.report || []).map((item) => {
              let location: any = {}
              let locationString = 'not available'
              let column = 0
              let row = 0
              let fileName = compiledFile
              if (item.location) {
                const split = item.location.split(':')
                const file = split[2]
                location = {
                  start: parseInt(split[0]),
                  length: parseInt(split[1])
                }
                location = props.analysisModule._deps.offsetToLineColumnConverter.offsetToLineColumn(
                  location,
                  parseInt(file),
                  lastCompilationSource.sources,
                  lastCompilationResult.sources
                )
                row = location.start.line
                column = location.start.column
                locationString = row + 1 + ':' + column + ':'
                fileName = Object.keys(lastCompilationResult.sources)[file]
              }
              const msg = message(item.name, item.warning, item.more, fileName, locationString)
              const options = {
                type: 'warning',
                useSpan: true,
                errFile: fileName,
                fileName,
                errLine: row,
                errCol: column,
                item: item,
                name: result.name,
                locationString,
                more: item.more,
                location: location
              }
              warningMessage.push({ msg, options, hasWarning: true, warningModuleName: moduleName, warningCategoryId: moduleCategoryId })
            })
          })
          // Slither Analysis
          if (slitherEnabled) {
            props.analysisModule.call('solidity-logic', 'getCompilerState').then((compilerState) => {
              if (!isCurrentRun()) return
              const { currentVersion, optimize, evmVersion } = compilerState
              props.analysisModule.call('terminal', 'log', { type: 'info', value: '[Slither Analysis]: Running...' })
              props.analysisModule.call('slither', 'analyse', slitherTargetFile, { currentVersion, optimize, evmVersion }).then((result) => {
                if (!isCurrentRun()) return
                if (result && result.status) {
                  props.analysisModule.call('terminal', 'log', { type: 'info', value: `[Slither Analysis]: Analysis Completed!! ${result.count} warnings found.` })
                  const report = Array.isArray(result.data) ? result.data : []
                  report.map((item) => {
                    let location: any = {}
                    let locationString = 'not available'
                    let column = 0
                    let row = 0
                    let fileName = slitherTargetFile

                    if (item.sourceMap && item.sourceMap.length) {
                      const fileIndex = Object.keys(lastCompilationResult.sources).indexOf(item.sourceMap[0].source_mapping.filename_relative)
                      if (fileIndex >= 0) {
                        location = {
                          start: item.sourceMap[0].source_mapping.start,
                          length: item.sourceMap[0].source_mapping.length
                        }
                        location = props.analysisModule._deps.offsetToLineColumnConverter.offsetToLineColumn(
                          location,
                          fileIndex,
                          lastCompilationSource.sources,
                          lastCompilationResult.sources
                        )
                        row = location.start.line
                        column = location.start.column
                        locationString = row + 1 + ':' + column + ':'
                        fileName = Object.keys(lastCompilationResult.sources)[fileIndex]
                      }
                    }
                    const msg = message(item.title, item.description, item.more, fileName, locationString)
                    const options = {
                      type: 'warning',
                      useSpan: true,
                      errFile: fileName,
                      fileName,
                      errLine: row,
                      errCol: column,
                      item: { warning: item.description },
                      name: item.title,
                      locationString,
                      more: item.more,
                      location: location
                    }
                    warningMessage.push({ msg, options, hasWarning: true, warningModuleName: 'Slither Analysis', warningCategoryId: 'SLITHER' })
                  })
                  finalize()
                } else {
                  props.analysisModule.call('terminal', 'log', { type: 'error', value: '[Slither Analysis]: Error occured! See remixd console for details.' })
                  finalize()
                }
              }).catch(() => {
                if (!isCurrentRun()) return
                props.analysisModule.call('terminal', 'log', { type: 'error', value: '[Slither Analysis]: Error occured! See remixd console for details.' })
                finalize()
              })
            }).catch(() => {
              if (!isCurrentRun()) return
              props.analysisModule.call('terminal', 'log', { type: 'error', value: '[Slither Analysis]: Error occured! See remixd console for details.' })
              finalize()
            })
          } else {
            finalize()
          }
        })
      } else {
        findingsRef.current = null
        setWarningState({})
        setHiddenLibraryCount(0)
        if (categoryIndex.length) {
          if (warningContainer.current) warningContainer.current.innerText = 'No compiled AST available'
        }
        setCategorySummary({})
        props.event.trigger('staticAnaysisWarning', [-1])
      }
    }
  }

  const handleCheckAllModules = (groupedModules) => {
    const index = groupedModuleIndex(groupedModules)
    if (index.every(el => categoryIndex.includes(el))) {
      setCategoryIndex(
        categoryIndex.filter((el) => {
          return !index.includes(el)
        })
      )
    } else {
      setCategoryIndex(_.uniq([...categoryIndex, ...index]))
    }
  }

  const handleCheckOrUncheckCategory = (category) => {
    const index = groupedModuleIndex(category)
    if (index.every(el => categoryIndex.includes(el))) {
      setCategoryIndex(
        categoryIndex.filter((el) => {
          return !index.includes(el)
        })
      )
    } else {
      setCategoryIndex(_.uniq([...categoryIndex, ...index]))
    }
  }

  const handleSlitherEnabled = () => {
    if (slitherEnabled) {
      setSlitherEnabled(false)
    } else {
      setSlitherEnabled(true)
    }
  }

  const handleAutoRun = () => {
    if (autoRun) {
      setAutoRun(false)
    } else {
      setAutoRun(true)
    }
  }

  // The last compilation result is only valid for the file it was produced from.
  // When the user switches to a contract that has not been compiled, there is no
  // usable AST for the active file, so analysis must not be runnable on it.
  const hasCompilationForCurrentFile = state.data !== null && !!state.file && state.file === currentFile
  const staticAnalysisDisabledReason = (() => {
    if (slitherEnabled) return ''
    if (!currentFile || !/\.sol$/i.test(currentFile)) {
      return 'Open a Solidity (.sol) file and compile it first. Run will enable when its compilation result is ready.'
    }
    if (!hasCompilationForCurrentFile) {
      return `Compile ${currentFile.split('/').pop()} first. Run will enable when its compilation result is ready.`
    }
    if (categoryIndex.length === 0) return 'Select at least one analysis category to enable Run.'
    return ''
  })()

  const handleCheckSingle = (event, _index) => {
    _index = _index.toString()
    if (categoryIndex.includes(_index)) {
      setCategoryIndex(categoryIndex.filter(val => val !== _index))
    } else {
      setCategoryIndex(_.uniq([...categoryIndex, _index]))
    }
  }

  const categoryItem = (categoryId, item, i) => {
    return (
      <div className="form-check" key={i}>
        <RemixUiCheckbox
          categoryId={categoryId}
          id={`staticanalysismodule_${categoryId}_${i}`}
          inputType="checkbox"
          name="checkSingleEntry"
          itemName={item.name}
          label={item.description}
          onClick={event => handleCheckSingle(event, item._index)}
          checked={categoryIndex.includes(item._index.toString())}
          onChange={() => {}}
        />
      </div>
    )
  }

  const categorySection = (category, categoryId, i) => {
    return (
      <div className="" key={i}>
        <div className="block">
          <TreeView>
            <TreeViewItem
              label={
                <label
                  htmlFor={`heading${categoryId}`}
                  style={{ cursor: 'pointer' }}
                  className="pl-3 card-header h6 d-flex justify-content-between font-weight-bold px-1 py-2 w-100"
                  data-bs-toggle="collapse"
                  data-bs-expanded="false"
                  data-bs-controls={`heading${categoryId}`}
                  data-bs-target={`#heading${categoryId}`}
                >
                  {category[0].categoryDisplayName}
                </label>
              }
              expand={false}
            >
              <div>
                <RemixUiCheckbox onClick={() => handleCheckOrUncheckCategory(category)} id={categoryId} inputType="checkbox" label={`Select ${category[0].categoryDisplayName}`} name='checkCategoryEntry' checked={category.map(x => x._index.toString()).every(el => categoryIndex.includes(el))} onChange={() => {}}/>
              </div>
              <div className="w-100 d-block px-2 my-1 entries collapse multi-collapse" id={`heading${categoryId}`}>
                {category.map((item, i) => {
                  return (
                    categoryItem(categoryId, item, i)
                  )
                })}
              </div>
            </TreeViewItem>
          </TreeView>
        </div>
      </div>
    )
  }

  return (
    <div className="analysis_3ECCBV px-3 pb-1">
      <div className="my-2 d-flex flex-column align-items-left">
        <div className="d-flex justify-content-between" id="staticanalysisButton">
          <RemixUiCheckbox
            id="checkAllEntries"
            inputType="checkbox"
            checked={Object.values(groupedModules).map((value: any) => {
              return (value.map(x => {
                return x._index.toString()
              }))
            }).flat().every(el => categoryIndex.includes(el))}
            label="Select all"
            onClick={() => handleCheckAllModules(groupedModules)}
            onChange={() => {}}
          />
          <RemixUiCheckbox
            id="autorunstaticanalysis"
            inputType="checkbox"
            onClick={handleAutoRun}
            checked={autoRun}
            label="Autorun"
            onChange={() => {}}
          />
          <Button buttonText="Run" onClick={() => run(state.data, state.source, state.file)} disabled={(!hasCompilationForCurrentFile || categoryIndex.length === 0) && !slitherEnabled }/>
        </div>
        { staticAnalysisDisabledReason &&
          <div className="alert alert-info small py-1 px-2 mt-2 mb-1" data-id="staticAnalysisDisabledReason" role="status">
            { staticAnalysisDisabledReason }
          </div>
        }
        <div className="d-flex mt-1" id="hideLibraryWarnings">
          <RemixUiCheckbox
            id="hideLibraryWarningsCheckbox"
            inputType="checkbox"
            onClick={() => setHideLibraryWarnings(!hideLibraryWarnings)}
            checked={hideLibraryWarnings}
            label="Hide results from imported libraries"
            onChange={() => {}}
          />
        </div>
        { hideLibraryWarnings && hiddenLibraryCount > 0 &&
          <div className="text-muted small mt-1" data-id="staticAnalysisHiddenLibraryNote">
            { hiddenLibraryCount } finding{ hiddenLibraryCount > 1 ? 's' : '' } in imported libraries (OpenZeppelin etc.) hidden — untick above to show them.
          </div>
        }
        { showSlither &&
          <div className="d-flex mt-2" id="enableSlitherAnalysis">
            <RemixUiCheckbox
              id="enableSlither"
              inputType="checkbox"
              onClick={handleSlitherEnabled}
              checked={slitherEnabled}
              label="Enable Slither Analysis"
              onChange={() => {}}
            />

            <a className="mt-1 text-nowrap" href='https://remix-ide.readthedocs.io/en/latest/slither.html#enable-slither-analysis' target={'_blank'}>
              <OverlayTrigger placement={'right'} overlay={
                <Tooltip className="text-nowrap" id="overlay-tooltip">
                  <span className="p-1 pr-3" style={{ backgroundColor: 'black', minWidth: '230px' }}>Learn how to use Slither Analysis</span>
                </Tooltip>
              }>
                <i style={{ fontSize: 'medium' }} className={'fal fa-info-circle ml-3'} aria-hidden="true"></i>
              </OverlayTrigger>
            </a>
          </div>
        }
      </div>
      <div id="staticanalysismodules" className="list-group list-group-flush">
        {Object.keys(groupedModules).map((categoryId, i) => {
          const category = groupedModules[categoryId]
          return (
            categorySection(category, categoryId, i)
          )
        })
        }
      </div>
      <div className="mt-2 p-2 d-flex border-top flex-column">
        <span>Last results for:</span>
        <span
          className="text-break break-word word-break font-weight-bold"
          id="staticAnalysisCurrentFile"
        >
          {state.file}
        </span>
      </div>
      <br/>
      <div ref={warningContainer} className="sr-only" aria-live="polite"></div>
      { Object.keys(categorySummary).length > 0 &&
        <div className="mb-2" data-id="staticAnalysisCategorySummary">
          <div className="d-flex flex-wrap align-items-center">
            { SUMMARY_ORDER.filter((c) => categorySummary[c.id]).map((c) => (
              <span
                key={c.id}
                className={`badge ${c.cls} mr-1 mb-1`}
                data-id={`staticAnalysisSummary-${c.id}`}
                title={ ADVISORY_CATEGORY_IDS.includes(c.id) ? 'Advisory / style reminders — not counted in the sidebar badge' : `${c.label} findings` }
              >
                { c.label } { categorySummary[c.id] }
              </span>
            )) }
          </div>
          { ADVISORY_CATEGORY_IDS.some((id) => categorySummary[id]) &&
            <div className="text-muted small mt-1">
              Advisory findings (assert/require reminders, naming) are shown below but excluded from the sidebar icon count.
            </div>
          }
        </div>
      }
      {Object.entries(warningState).length > 0 &&
        <div id='staticanalysisresult' >
          <div className="mb-4">
            {
              (Object.entries(warningState).map((element, index) => (
                <div key={index}>
                  <div
                    className="d-flex align-items-center"
                    style={{ cursor: 'pointer' }}
                    data-id={`staticAnalysisGroupHeader${element[0]}`}
                    role="button"
                    tabIndex={0}
                    aria-expanded={!collapsedGroups[element[0]]}
                    onClick={() => setCollapsedGroups(prev => ({ ...prev, [element[0]]: !prev[element[0]] }))}
                    onKeyDown={(e) => {
                      // advisory groups start collapsed — without a key handler
                      // they were unreachable for keyboard/screen-reader users
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault() // Space must not scroll the panel
                        setCollapsedGroups(prev => ({ ...prev, [element[0]]: !prev[element[0]] }))
                      }
                    }}
                  >
                    <span className="text-dark h6 mb-0">{element[0]}</span>
                    <span className="badge badge-light ml-2">{(element[1] as any[]).length}</span>
                    <i className={`fas ml-1 small fa-angle-${collapsedGroups[element[0]] ? 'right' : 'down'}`} aria-hidden="true"></i>
                  </div>
                  {!collapsedGroups[element[0]] && element[1]['map']((x, i) => ( // eslint-disable-line dot-notation
                    x.hasWarning ? ( // eslint-disable-next-line  dot-notation
                      <div id={`staticAnalysisModule${element[1]['warningModuleName']}`} key={i}>
                        <ErrorRenderer message={x.msg} opt={x.options} warningErrors={ x.warningErrors} editor={props.analysisModule}/>
                      </div>

                    ) : null
                  ))}
                </div>
              )))
            }
          </div>
        </div>
      }
    </div>
  )
}

export default RemixUiStaticAnalyser
