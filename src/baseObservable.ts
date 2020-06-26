export type Listener<T> = (val: T, prevVal: T) => void;
export type Unsubscriber = () => void;

let capturedInputs: BaseObservable<any>[] | undefined;
let inputAlreadyCaptured = false;

export class BaseObservable<T> {
	private _val!: T;
	private _valInput: BaseObservable<T> | undefined;
	private _inputs: BaseObservable<any>[] = [];
	private _outputs: BaseObservable<any>[] = [];
	private _listeners: Listener<T>[] = [];
	private _attachedToInputs = false;
	private _dirty = false;

	constructor(val: T | BaseObservable<T>) {
		this._set(val);
	}

	get(): T {
		if (!capturedInputs || inputAlreadyCaptured) {
			const val = this._get();
			return val instanceof BaseObservable ? val.get() : val;
		} else {
			try {
				capturedInputs.push(this);
				inputAlreadyCaptured = true;
				const val = this._get();
				return val instanceof BaseObservable ? val.get() : val;
			} finally {
				inputAlreadyCaptured = false;
			}
		}
	}

	protected _get(): T | BaseObservable<T> {
		return this._valInput ? this._valInput : this._val;
	}

	protected _set(val: T | BaseObservable<T>) {
		// If the value is an observable, add it as an input.
		// If the previous value was an observable, remove it from the inputs
		const valInput = val instanceof BaseObservable ? val : undefined;
		if (this._valInput !== valInput) {
			if (this._valInput) {
				this.removeInput(this._valInput);
			}
			this._valInput = valInput;
			if (valInput) {
				this.addInput(valInput);
			}
		}

		const newVal = valInput ? valInput.get() : (val as T);
		if (this._val !== newVal) {
			const prevVal = this._val;
			this._val = newVal;
			this._dirty = false;

			// Invalidate outputs before notifying listeners.
			// This way, if get() is called on an outputs from a listener, it'll be already up-to-date
			for (const output of this._outputs) {
				output.invalidate();
			}

			// Notify listeners
			for (const listener of this._listeners.slice()) {
				listener(newVal, prevVal);
			}

			// Refresh outputs that may have changed
			for (const output of this._outputs) {
				output._set(output._get());
			}
		}
	}

	onChange(listener: Listener<T>): Unsubscriber {
		this._listeners.push(listener);
		this.attachToInputs();

		let listenerRemoved = false;
		return () => {
			if (!listenerRemoved) {
				listenerRemoved = true;
				this._listeners.splice(this._listeners.indexOf(listener), 1);
				this.detachFromInputs();
			}
		};
	}

	protected shouldEvaluate(): boolean {
		return !this._attachedToInputs || this._dirty;
	}

	protected static evaluateAndCaptureInputs<T>(
		block: () => T
	): { value: T; inputs: BaseObservable<any>[] } {
		if (capturedInputs) {
			throw "Calling Observable.compute() from the compute function of another Observable.compute() call is unsupported";
		}
		try {
			capturedInputs = [];
			const value = block();
			return { value, inputs: capturedInputs };
		} finally {
			capturedInputs = undefined;
		}
	}

	protected setInputs(inputs: BaseObservable<any>[]) {
		// Note: if either inputs or this._inputs contain many items, this could be quite computation-heavy.
		// Using a Set might help here for these cases
		const addedInputs =
			this._inputs.length > 0
				? inputs.filter(newInput => this._inputs.every(oldInput => oldInput !== newInput))
				: inputs;
		const removedInputs =
			this._inputs.length > 0
				? this._inputs.filter(oldInput => this._inputs.every(newInput => oldInput !== newInput))
				: [];
		for (const input of removedInputs) {
			this.removeInput(input);
		}
		for (const input of addedInputs) {
			this.addInput(input);
		}
	}

	private addInput(input: BaseObservable<any>) {
		this._inputs.push(input);
		if (this._attachedToInputs) {
			this.attachToInput(input);
		}
	}

	private removeInput(input: BaseObservable<any>) {
		this._inputs.splice(this._inputs.indexOf(input), 1);
		if (this._attachedToInputs) {
			this.detachFromInput(input);
		}
	}

	private shouldAttachToInputs(): boolean {
		// Only attach to inputs when at least one listener is subscribed to the observable or to one of its outputs.
		// This is done to avoid unused observables being references by their inputs, preventing garbage-collection.
		return this._listeners.length > 0 || this._outputs.length > 0;
	}

	private attachToInputs() {
		if (!this._attachedToInputs && this.shouldAttachToInputs()) {
			for (const input of this._inputs) {
				this.attachToInput(input);
				input.attachToInputs();
			}

			// Since the observable was not attached to its inputs, its value may be outdated.
			// Refresh it so that onChange() will be called with the correct prevValue the next time an input changes.
			this._val = this.get();
			this._dirty = false;
			this._attachedToInputs = true;
		}
	}

	private detachFromInputs() {
		if (this._attachedToInputs && !this.shouldAttachToInputs()) {
			this._attachedToInputs = false;
			for (const input of this._inputs) {
				this.detachFromInput(input);
				input.detachFromInputs();
			}
		}
	}

	private attachToInput(input: BaseObservable<any>) {
		input._outputs.push(this);
		if (input._dirty) {
			this.invalidate();
		}
	}

	private detachFromInput(input: BaseObservable<any>) {
		input._outputs.splice(input._outputs.indexOf(this), 1);
	}

	private invalidateOutputs() {
		for (const output of this._outputs) {
			output.invalidate();
		}
	}

	private invalidate() {
		if (!this._dirty) {
			this._dirty = true;
			this.invalidateOutputs();
		}
	}
}