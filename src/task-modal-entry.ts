import { TaskModal } from './modal';

document.addEventListener('DOMContentLoaded', () => {
    const modal = new TaskModal();
    // Initialize with empty email data for standalone mode
    modal.show({
        threadId: '',
        subject: '',
        from: '',
        html: ''
    });
});
