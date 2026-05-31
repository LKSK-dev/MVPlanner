import { render } from 'solid-js/web';
import { App } from './App';
import './core/theme/tokens.css';
import './app.css';

const root = document.getElementById('app');
if (!root) throw new Error('MVPlanner: #app root element not found');

render(() => <App />, root);
