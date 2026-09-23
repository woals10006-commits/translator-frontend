import { useState, useEffect, useRef } from 'react'

const API = 'http://localhost:8080/api/proofread'

const EMPTY_WORK = { id: '', name: '', folder: '', prompt: '', glossary: '', issueWords: '' }
const ACCEPT = '.docx,.hwp,.hwpx,.txt'
const ACCEPT_RE = /\.(docx|hwp|hwpx|txt)$/i

/**
 * AI 교정교열 화면.
 *
 * 원고를 넣는 길이 두 가지다.
 *  1) 작품을 등록해 두고 그 폴더에서 고르기 — 결과 TXT 가 원고 옆에 저장된다.
 *  2) 파일을 끌어다 놓기 — 브라우저는 그 파일이 어느 폴더에서 왔는지 알려주지
 *     않으므로 결과는 다운로드 폴더에 저장된다.
 *
 * 어느 쪽이든 교정은 파일 전체가 아니라 화 단위로 나뉘어 나간다.
 */
export default function Proofread() {
  const [works, setWorks] = useState([])
  const [workId, setWorkId] = useState('')
  const [files, setFiles] = useState([])
  const [fileName, setFileName] = useState('')
  const [dropFile, setDropFile] = useState(null)
  const [chapters, setChapters] = useState(0)
  const [startChapter, setStartChapter] = useState('1')
  const [endChapter, setEndChapter] = useState('1')

  const [manage, setManage] = useState(false)
  const [form, setForm] = useState(EMPTY_WORK)
  const [commonPrompt, setCommonPrompt] = useState('')

  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('')
  const [cost, setCost] = useState('')
  const [savedPath, setSavedPath] = useState('')
  const [notes, setNotes] = useState([])
  const [error, setError] = useState('')
  // 이번 검토에만 쓸 프롬프트. 비워 두면 작품에 등록한 것(없으면 공통)을 쓴다.
  const [prompt, setPrompt] = useState('')
  const [promptSource, setPromptSource] = useState('')
  const [promptDragging, setPromptDragging] = useState(false)
  const pollRef = useRef()
  const dropRef = useRef()
  const promptRef = useRef()

  const cleanNum = (v) => v.replace(/\D/g, '').replace(/^0+(?=\d)/, '')
  const work = works.find((w) => w.id === workId)
  const ready = (dropFile || (workId && fileName)) && !running

  useEffect(() => {
    loadWorks()
    fetch(`${API}/common-prompt`)
      .then((r) => r.json())
      .then((d) => setCommonPrompt(d.prompt || ''))
      .catch(() => {})
    return () => clearInterval(pollRef.current)
  }, [])

  // 작품을 고르면 그 폴더의 원고 목록을 읽어 온다.
  useEffect(() => {
    setFiles([]); setFileName('')
    if (!workId) return
    fetch(`${API}/works/${workId}/files`)
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d)) setFiles(d)
        else setError(d.error || '폴더를 읽지 못했습니다.')
      })
      .catch(() => setError('백엔드에 연결하지 못했습니다. 번역기 서버가 켜져 있는지 확인해 주세요.'))
  }, [workId])

  // 폴더에서 원고를 고르면 그 파일에 화가 몇 개 있는지 세어 범위 칸을 채운다.
  useEffect(() => {
    if (!workId || !fileName || dropFile) return
    setChapters(0)
    // 한글 파일명이 쿼리 문자열에서 깨지므로 JSON 본문으로 보낸다.
    fetch(`${API}/works/${workId}/chapters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.chapters) applyChapterCount(d.chapters)
        else if (d.error) setError(d.error)
      })
      .catch(() => {})
  }, [fileName])

  const applyChapterCount = (n) => {
    setChapters(n)
    setStartChapter('1')
    setEndChapter(String(n))
  }

  // 끌어다 놓은 원고는 서버에 한 번 보내 화가 몇 개인지 먼저 세어 본다.
  const pickDropped = async (f) => {
    if (!f) return
    if (!ACCEPT_RE.test(f.name)) {
      setError('워드(.docx), 한글(.hwp/.hwpx), 텍스트(.txt) 파일만 넣을 수 있습니다.')
      return
    }
    setError(''); setSavedPath(''); setNotes([])
    setDropFile(f); setFileName(''); setChapters(0)
    const fd = new FormData()
    fd.append('file', f)
    try {
      const d = await fetch(`${API}/inspect`, { method: 'POST', body: fd }).then((r) => r.json())
      if (d.chapters) applyChapterCount(d.chapters)
      else setError(d.error || '원고를 읽지 못했습니다.')
    } catch {
      setError('원고를 읽지 못했습니다. 번역기 서버가 켜져 있는지 확인해 주세요.')
    }
  }

  // 프롬프트를 파일로 넣는 길. 담당자들이 프롬프트를 워드·한글 문서로 주고받아
  // 서버에서 글자만 뽑아 입력칸에 채워 준다.
  const loadPromptFile = async (f) => {
    if (!f) return
    setError('')
    const fd = new FormData()
    fd.append('file', f)
    try {
      const d = await fetch(`${API}/extract-text`, { method: 'POST', body: fd }).then((r) => r.json())
      if (d.text) {
        setPrompt(d.text)
        setPromptSource(f.name)
      } else {
        setError(d.error || '프롬프트 파일을 읽지 못했습니다.')
      }
    } catch {
      setError('프롬프트 파일을 읽지 못했습니다.')
    }
  }

  const loadWorks = async () => {
    try {
      const list = await fetch(`${API}/works`).then((r) => r.json())
      setWorks(list)
      if (list.length && !list.some((w) => w.id === workId)) setWorkId(list[0].id)
      return list
    } catch {
      setError('백엔드에 연결하지 못했습니다. 번역기 서버(localhost:8080)가 켜져 있는지 확인해 주세요.')
      return []
    }
  }

  const openNew = () => {
    // 새 작품은 공통 프롬프트를 채워 두고 시작한다. 담당자가 여기서 자기
    // 방식대로 고쳐 저장하면 그게 이 작품의 프롬프트가 된다.
    setForm({ ...EMPTY_WORK, prompt: commonPrompt })
    setManage(true)
  }

  const openEdit = (w) => {
    setForm({ ...EMPTY_WORK, ...w })
    setManage(true)
  }

  const saveWork = async () => {
    setError('')
    try {
      const res = await fetch(`${API}/works`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || '작품을 저장하지 못했습니다.'); return }
      const list = await loadWorks()
      if (list.some((w) => w.id === data.id)) setWorkId(data.id)
      setManage(false)
    } catch {
      setError('작품을 저장하지 못했습니다.')
    }
  }

  const deleteWork = async () => {
    if (!form.id) { setManage(false); return }
    if (!window.confirm(`"${form.name}" 작품 등록을 지울까요? 원고 파일은 지워지지 않습니다.`)) return
    await fetch(`${API}/works/${form.id}`, { method: 'DELETE' })
    setWorkId('')
    await loadWorks()
    setManage(false)
  }

  const start = async () => {
    setError(''); setSavedPath(''); setNotes([]); setProgress(0); setCost('')
    setRunning(true)
    setStatus('원고를 화 단위로 나누는 중')
    try {
      let res
      if (dropFile) {
        const fd = new FormData()
        fd.append('file', dropFile)
        if (workId) fd.append('workId', workId)
        if (prompt.trim()) fd.append('prompt', prompt)
        fd.append('startChapter', startChapter || '1')
        fd.append('endChapter', endChapter || startChapter || '1')
        res = await fetch(`${API}/start-upload`, { method: 'POST', body: fd })
      } else {
        res = await fetch(`${API}/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workId,
            fileName,
            prompt: prompt.trim() || null,
            startChapter: startChapter || '1',
            endChapter: endChapter || startChapter || '1',
          }),
        })
      }
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '교정교열을 시작하지 못했습니다.')

      pollRef.current = setInterval(async () => {
        try {
          const p = await fetch(`${API}/progress/${data.jobId}`).then((r) => r.json())
          setProgress(p.progress || 0)
          setStatus(p.status || '')
          setCost(p.cost || '')
          setNotes(p.notes || [])
          if (p.done) {
            clearInterval(pollRef.current)
            setRunning(false)
            if (p.error) setError(p.error)
            else setSavedPath(p.savedPath || '')
          }
        } catch {
          clearInterval(pollRef.current)
          setRunning(false)
          setError('진행 상황을 확인하지 못했습니다.')
        }
      }, 1500)
    } catch (e) {
      setRunning(false)
      setError(e.message)
    }
  }

  // ===== 작품 등록/수정 =====
  if (manage) {
    return (
      <>
        <button className="back-btn" onClick={() => setManage(false)}>← 뒤로</button>
        <h1>{form.id ? '작품 수정' : '작품 등록'}</h1>
        <p className="subtitle">작품마다 원고 폴더와 프롬프트를 따로 등록해 두면 소설이 섞이지 않습니다.</p>

        <div className="field">
          <label>작품명</label>
          <input
            value={form.name}
            placeholder="예: 과거문계모양아일상"
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <span className="hint">프롬프트 안의 {'{{작품명}}'} 자리에 이 이름이 들어갑니다.</span>
        </div>

        <div className="field">
          <label>원고 폴더 경로</label>
          <input
            value={form.folder}
            placeholder="예: C:\소설\과거문계모양아일상"
            onChange={(e) => setForm({ ...form, folder: e.target.value })}
          />
          <span className="hint">
            결과 TXT 도 이 폴더에 저장됩니다. 탐색기 주소창의 경로를 그대로 복사해 붙여 넣으세요.
          </span>
        </div>

        <div className="field">
          <label>
            교정교열 프롬프트
            <button
              type="button"
              className="inline-btn"
              onClick={() => setForm({ ...form, prompt: commonPrompt })}
            >
              공통 프롬프트 불러오기
            </button>
          </label>
          <textarea
            rows={10}
            value={form.prompt}
            placeholder="비워 두면 공통 프롬프트가 쓰입니다."
            onChange={(e) => setForm({ ...form, prompt: e.target.value })}
          />
        </div>

        <div className="field">
          <label>인명·호칭·용어집 <span className="optional">(선택)</span></label>
          <textarea
            rows={5}
            value={form.glossary}
            placeholder={'한 줄에 하나씩 적으세요.\n예) 심요 — 여주인공, 승상부 셋째 딸\n예) 배연 → 裴衍 (남주인공, 이 표기로 통일)'}
            onChange={(e) => setForm({ ...form, glossary: e.target.value })}
          />
          <span className="hint">
            화를 나눠 검토하기 때문에 앞 화 표기를 모델이 볼 수 없습니다. 여기 적어 두면 매 화에 함께 전달됩니다.
          </span>
        </div>

        <div className="field">
          <label>이슈단어 목록 <span className="optional">(선택)</span></label>
          <textarea
            rows={4}
            value={form.issueWords}
            placeholder={'한 줄에 하나씩. 예)\n저고리\n설날\n추석'}
            onChange={(e) => setForm({ ...form, issueWords: e.target.value })}
          />
          <span className="hint">
            교정이 끝난 뒤 이 단어들로 원고를 기계적으로 한 번 더 검색해 결과 맨 아래에 붙입니다.
          </span>
        </div>

        {error && <p className="error">{error}</p>}

        <button className="translate-btn" onClick={saveWork}>저장</button>
        {form.id && (
          <button className="danger-btn" onClick={deleteWork}>이 작품 등록 지우기</button>
        )}
      </>
    )
  }

  // ===== 교정교열 실행 =====
  return (
    <>
      <h1>AI 교정교열</h1>
      <p className="subtitle">원고를 화 단위로 나누어 검토하고, 수정 목록을 TXT로 저장합니다.</p>

      <div
        className={`dropzone ${dropFile ? 'has-file' : ''}`}
        onDrop={(e) => { e.preventDefault(); if (!running) pickDropped(e.dataTransfer.files[0]) }}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => !running && dropRef.current.click()}
      >
        <input
          type="file"
          accept={ACCEPT}
          ref={dropRef}
          onChange={(e) => pickDropped(e.target.files[0])}
          style={{ display: 'none' }}
        />
        {dropFile ? (
          <div className="file-info">
            <span className="file-icon">📄</span>
            <span className="file-name">{dropFile.name}</span>
          </div>
        ) : (
          <div className="drop-hint">
            <div className="upload-icon">↑</div>
            <p>클릭하거나 원고를 드래그하세요</p>
            <p className="small">워드(.docx) · 한글(.hwp) · 텍스트(.txt)</p>
          </div>
        )}
      </div>

      {dropFile && (
        <p className="hint center">
          끌어다 놓은 원고는 저장 위치를 알 수 없어, 결과가 <b>다운로드 폴더</b>에 저장됩니다.
          원고 옆에 바로 저장하려면 아래에서 작품을 등록해 쓰세요.
          <button type="button" className="link-btn" onClick={() => { setDropFile(null); setChapters(0) }}>
            드래그한 파일 빼기
          </button>
        </p>
      )}

      <div className="field">
        <label>
          {dropFile ? '작품 설정' : '작품'}
          <span className="optional">{dropFile ? '(선택 · 프롬프트와 용어집만 사용)' : ''}</span>
          <button type="button" className="inline-btn" onClick={openNew}>+ 작품 등록</button>
          {work && (
            <button type="button" className="inline-btn" onClick={() => openEdit(work)}>설정 수정</button>
          )}
        </label>
        {works.length === 0 ? (
          <p className="empty-box">
            등록된 작품이 없습니다. 지금은 <b>공통 프롬프트</b>로 검토합니다.
            작품을 등록하면 프롬프트·용어집을 따로 두고, 결과도 원고 폴더에 바로 저장됩니다.
          </p>
        ) : (
          <select value={workId} disabled={running} onChange={(e) => setWorkId(e.target.value)}>
            {dropFile && <option value="">— 공통 프롬프트로 검토 —</option>}
            {works.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        )}
        {work && !dropFile && <span className="hint">원고 폴더: {work.folder}</span>}
      </div>

      {work && !dropFile && (
        <div className="field">
          <label>원고 파일</label>
          {files.length === 0 ? (
            <p className="empty-box">이 폴더에 워드·한글·텍스트 원고가 없습니다.</p>
          ) : (
            <select value={fileName} disabled={running} onChange={(e) => setFileName(e.target.value)}>
              <option value="">— 원고를 선택하세요 —</option>
              {files.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {chapters > 0 && (
        <div className="field">
          <label>검토할 화 범위 <span className="optional">이 원고에는 {chapters}화가 들어 있습니다</span></label>
          <div className="chapter-input">
            <input
              value={startChapter}
              disabled={running}
              onChange={(e) => setStartChapter(cleanNum(e.target.value))}
            />
            <span>화 ~</span>
            <input
              value={endChapter}
              disabled={running}
              onChange={(e) => setEndChapter(cleanNum(e.target.value))}
            />
            <span>화</span>
          </div>
          <span className="hint">한 화씩 따로 검토합니다. 처음이라면 1~2화만 돌려 결과를 먼저 확인해 보세요.</span>
        </div>
      )}

      <div className="field">
        <label>
          교정 요청사항 (프롬프트)
          <span className="optional">(선택)</span>
          <button type="button" className="inline-btn" onClick={() => promptRef.current.click()}>
            파일에서 불러오기
          </button>
          <button
            type="button"
            className="inline-btn"
            onClick={() => { setPrompt(commonPrompt); setPromptSource('공통 프롬프트') }}
          >
            공통 프롬프트
          </button>
        </label>
        <input
          type="file"
          ref={promptRef}
          onChange={(e) => loadPromptFile(e.target.files[0])}
          style={{ display: 'none' }}
        />
        {/* 프롬프트 문서를 이 칸에 그대로 끌어다 놓을 수 있게 한다. 브라우저는
            기본적으로 텍스트칸에 떨어진 파일을 열어 버리므로 막아 준다. */}
        <div
          className={`drop-target ${promptDragging ? 'dragging' : ''}`}
          onDragOver={(e) => { e.preventDefault(); if (!running) setPromptDragging(true) }}
          onDragLeave={() => setPromptDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setPromptDragging(false)
            if (!running) loadPromptFile(e.dataTransfer.files[0])
          }}
        >
          <textarea
            rows={6}
            value={prompt}
            disabled={running}
            placeholder={'비워 두면 등록한 작품의 프롬프트를 쓰고, 그것도 없으면 공통 프롬프트를 씁니다.\n\n여기에 직접 붙여넣거나, 프롬프트 문서를 이 칸에 끌어다 놓으세요.\n(워드 · 한글 · 텍스트 파일)'}
            onChange={(e) => { setPrompt(e.target.value); setPromptSource('') }}
          />
          {promptDragging && <div className="drop-veil">여기에 놓으면 프롬프트로 불러옵니다</div>}
        </div>
        <span className="hint">
          {promptSource
            ? `“${promptSource}” 에서 불러왔습니다. 이 내용이 이번 검토에 그대로 쓰입니다.`
            : prompt.trim()
            ? '여기 적은 내용이 이번 검토에 쓰입니다.'
            : '비워 두면 작품에 등록한 프롬프트 → 공통 프롬프트 순서로 쓰입니다.'}
        </span>
      </div>

      <button className="translate-btn" disabled={!ready} onClick={start}>
        {running ? '검토 중...' : '교정교열 시작'}
      </button>

      {running && (
        <div className="progress-wrap">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <p className="progress-text">{status || '준비 중'} ({progress}%)</p>
          {cost && cost !== '0.00' && <p className="saved-path">지금까지 쓴 금액: 약 ${cost}</p>}
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {savedPath && (
        <>
          <p className="success">교정교열이 끝났습니다.</p>
          <p className="saved-path"><code>{savedPath}</code></p>
          {cost && <p className="saved-path">이번 작업 비용: 약 ${cost}</p>}
        </>
      )}

      {notes.length > 0 && (
        <div className="notes">
          <b>확인이 필요한 항목</b>
          <ul>{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </div>
      )}
    </>
  )
}
