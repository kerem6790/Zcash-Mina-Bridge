import { Field, SmartContract, state, State, method } from 'o1js';

export class Counter extends SmartContract {
    @state(Field) num = State<Field>();

    init() {
        super.init();
        this.num.set(Field(0));
    }

    @method async update(square: Field) {
        const currentState = this.num.getAndRequireEquals();
        const newState = currentState.add(1);
        newState.mul(newState).assertEquals(square);
        this.num.set(newState);
    }
}
