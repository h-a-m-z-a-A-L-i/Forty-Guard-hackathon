import React from 'react'; import { createRoot } from 'react-dom/client'; import './styles.css'; import App from './App';
const root = document.getElementById('root');
class AppErrorBoundary extends React.Component { state = { error: null }; static getDerivedStateFromError(error) { return { error }; } componentDidCatch(error) { console.error('ShadeRoute render error:', error); } render() { return this.state.error ? <main style={{ padding: 40, fontFamily: 'system-ui', color: '#a52e22' }}><h1>ShadeRoute could not start</h1><p>{this.state.error.message}</p></main> : this.props.children; } }
createRoot(root).render(<AppErrorBoundary><App /></AppErrorBoundary>);
