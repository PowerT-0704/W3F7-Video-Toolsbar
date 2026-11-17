import { createRoot } from 'react-dom/client'
import { App } from './App'
import { applyTheme, initialTheme } from './workspace'
import './styles.css'

applyTheme(initialTheme)
createRoot(document.getElementById('root')!).render(<App />)
