export function boxQuestions(product) {
  return product?.box_questions ?? (product?.option_groups || []).filter(group => group.id !== 'flavors' && group.required_count === 1);
}

export function validBoxAnswers(questions, selections = {}) {
  const answers = {};
  for (const question of questions) {
    const selected = question.choices.find(choice => choice.active !== false && selections[question.id]?.[choice.id] === 1);
    if (selected) answers[question.id] = {[selected.id]: 1};
  }
  return answers;
}

export function boxQuestionFields(questions, selections, {esc, money}) {
  return questions.map(question => `<fieldset class="option-group box-question">
    <legend>${esc(question.label)} <small>Choose one</small></legend>
    ${question.choices.filter(choice => choice.active !== false).map(choice => `<label class="box-answer">
      <input type="radio" required name="box-question-${esc(question.id)}" data-group="${esc(question.id)}" data-choice="${esc(choice.id)}" value="${esc(choice.id)}" ${selections[question.id]?.[choice.id] === 1 ? 'checked' : ''}>
      <span>${esc(choice.label)}</span><small>${choice.surcharge_cents ? '+' + esc(money(choice.surcharge_cents)) : 'Included'}</small>
    </label>`).join('')}
  </fieldset>`).join('');
}
