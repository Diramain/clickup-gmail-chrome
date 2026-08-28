export class AuthenticationOperationCoordinator {
    private operationQueue: Promise<void> = Promise.resolve();
    private stateQueue: Promise<void> = Promise.resolve();

    runOperation<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.operationQueue.then(operation, operation);
        this.operationQueue = result.then(() => undefined, () => undefined);
        return result;
    }

    runStateMutation<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.stateQueue.then(operation, operation);
        this.stateQueue = result.then(() => undefined, () => undefined);
        return result;
    }
}
