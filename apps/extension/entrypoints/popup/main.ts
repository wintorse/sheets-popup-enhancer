import '@spe/diff-ui/theme.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { localeFor } from '../../src/i18n';
const locale = localeFor(navigator.language);
document.documentElement.lang = locale.replace('_', '-');
mount(App, { target: document.getElementById('app')! });
