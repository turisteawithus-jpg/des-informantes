import { Routes, Route } from 'react-router'
import Home from './pages/Home'
import Register from './pages/Register'
import VerifyEmail from './pages/VerifyEmail'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import WorkspaceView from './pages/WorkspaceView'
import DiscussionRoom from './pages/DiscussionRoom'
import Admin from './pages/Admin'
import Conversations from './pages/Conversations'
import ConversationView from './pages/ConversationView'
import NotFound from './pages/NotFound'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/register" element={<Register />} />
      <Route path="/verify" element={<VerifyEmail />} />
      <Route path="/login" element={<Login />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/workspace/:id" element={<WorkspaceView />} />
      <Route path="/discussion/:id" element={<DiscussionRoom />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="/conversations" element={<Conversations />} />
      <Route path="/conversation/:id" element={<ConversationView />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
